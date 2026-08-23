import asyncio
import importlib.util
import sys
from datetime import datetime, timezone

from pathlib import Path
from typing import Any

import pytest

from models.execution_envelope import (
    APEX_POLICY_VERSION,
    assert_mutation_envelope,
    create_execution_envelope,
    derive_intent_hash,
    parse_trace_context,
    continue_trace_context,
)
from security.guardian_fabric import GuardianPolicyRule, evaluate_guardian_policy

UTC = timezone.utc


def load_compensation_catalog() -> Any:
    module_path = Path(__file__).parents[1] / "activities" / "compensation_catalog.py"
    spec = importlib.util.spec_from_file_location("apex_compensation_catalog", module_path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_execution_envelope_is_stable_for_same_action() -> None:
    first = create_execution_envelope(
        actor_id="user-1",
        device_id="device-1",
        action="workflow.submit",
        resource="wf:alpha",
        payload={"b": 2, "a": 1},
        stale_after="2099-01-01T00:00:00+00:00",
    )
    second = create_execution_envelope(
        actor_id="user-1",
        device_id="device-1",
        action="workflow.submit",
        resource="wf:alpha",
        payload={"a": 1, "b": 2},
        stale_after="2099-01-01T00:00:00+00:00",
    )
    assert first.intent_hash == second.intent_hash
    assert first.idempotency_key == second.idempotency_key
    assert first.correlation_id == second.correlation_id


def test_mutating_request_requires_envelope_fields() -> None:
    with pytest.raises(ValueError, match="apex_envelope_invalid_trace_id"):
        assert_mutation_envelope("POST", {"attempt": 1})


def test_mutating_request_fails_closed_when_stale() -> None:
    envelope = create_execution_envelope(
        actor_id="user-1",
        device_id="device-1",
        action="mutate",
        resource="r",
        stale_after="2020-01-01T00:00:00+00:00",
    )
    with pytest.raises(ValueError, match="apex_stale_event"):
        assert_mutation_envelope(
            "POST", envelope.__dict__, datetime(2021, 1, 1, tzinfo=timezone.utc)
        )


def test_hash_is_order_independent() -> None:
    assert derive_intent_hash("u", "d", "a", "r", {"z": 1, "a": [2, 3]}) == derive_intent_hash(
        "u", "d", "a", "r", {"a": [2, 3], "z": 1}
    )


def test_trace_continuity_across_boundaries() -> None:
    browser = continue_trace_context()
    edge = continue_trace_context(
        parse_trace_context({"traceparent": browser.traceparent, "tracestate": "apex=browser"})
    )
    orchestrator = parse_trace_context(
        {
            "traceparent": edge.traceparent,
            "tracestate": edge.tracestate or "",
        }
    )
    assert orchestrator is not None
    assert orchestrator.trace_id == browser.trace_id


def _envelope(device_id: str = "device-1", policy_version: str = APEX_POLICY_VERSION):
    return create_execution_envelope(
        actor_id="user-1",
        device_id=device_id,
        action="admin.rotate_key",
        resource="secret:stripe",
        stale_after="2099-01-01T00:00:00+00:00",
        policy_version=policy_version,
    )


def test_guardian_allow_path() -> None:
    decision = evaluate_guardian_policy(
        principal="user-1",
        action="admin.rotate_key",
        resource="secret:stripe",
        context={"mfa_verified": True},
        envelope=_envelope(),
        rules=(
            GuardianPolicyRule(
                id="apex.guardian.admin.rotate_key",
                effect="allow",
                reason_code="ADMIN_CONTEXT_VALID",
                policy_version=APEX_POLICY_VERSION,
                actions=("admin.rotate_key",),
                resources=("secret:stripe",),
                required_context=("mfa_verified",),
                allowed_device_ids=("device-1",),
            ),
        ),
    )
    assert decision.decision == "allow"
    assert decision.reason_code == "ADMIN_CONTEXT_VALID"


@pytest.mark.parametrize(
    ("context", "device_id", "policy_version", "reason"),
    [
        ({}, "device-1", APEX_POLICY_VERSION, "MISSING_CONTEXT"),
        ({"mfa_verified": True}, "device-2", APEX_POLICY_VERSION, "WRONG_DEVICE"),
        ({"mfa_verified": True}, "device-1", "apex.policy.old", "STALE_POLICY_VERSION"),
    ],
)
def test_guardian_deny_paths(
    context: dict[str, bool], device_id: str, policy_version: str, reason: str
) -> None:
    decision = evaluate_guardian_policy(
        principal="user-1",
        action="admin.rotate_key",
        resource="secret:stripe",
        context=context,
        envelope=_envelope(device_id, policy_version),
        rules=(
            GuardianPolicyRule(
                id="apex.guardian.admin.rotate_key",
                effect="allow",
                reason_code="ADMIN_CONTEXT_VALID",
                policy_version=APEX_POLICY_VERSION,
                actions=("admin.rotate_key",),
                resources=("secret:stripe",),
                required_context=("mfa_verified",),
                allowed_device_ids=("device-1",),
            ),
        ),
        current_policy_version=APEX_POLICY_VERSION,
    )
    assert decision.decision == "deny"
    assert decision.reason_code == reason


def test_guardian_default_deny_when_no_rule_matches() -> None:
    decision = evaluate_guardian_policy(
        principal="user-1",
        action="admin.delete_user",
        resource="user:2",
        context={"mfa_verified": True},
        envelope=_envelope(),
        rules=(),
    )
    assert decision.decision == "deny"
    assert decision.reason_code == "NO_MATCHING_POLICY"


def test_guardian_denies_stale_event() -> None:
    stale_envelope = create_execution_envelope(
        actor_id="user-1",
        device_id="device-1",
        action="admin.rotate_key",
        resource="secret:stripe",
        stale_after="2020-01-01T00:00:00+00:00",
    )
    decision = evaluate_guardian_policy(
        principal="user-1",
        action="admin.rotate_key",
        resource="secret:stripe",
        context={"mfa_verified": True},
        envelope=stale_envelope,
        rules=(),
        now=datetime(2021, 1, 1, tzinfo=timezone.utc),
    )
    assert decision.decision == "deny"
    assert decision.reason_code == "STALE_EVENT"


@pytest.mark.asyncio
async def test_compensation_catalog_register_get_and_handler() -> None:
    compensation_catalog = load_compensation_catalog()

    async def handler(payload: dict[str, object]) -> dict[str, object]:
        await asyncio.sleep(0)  # Exercise the async compensation contract without side effects.
        return {"compensated": True, "payload": payload}

    catalog = compensation_catalog.CompensationCatalog()
    entry = compensation_catalog.CompensationEntry(
        ref="apex.comp.billing.rollback",
        owner="billing",
        description="Rollback billing side effect",
        handler=handler,
    )
    catalog.register(entry)

    assert catalog.get(entry.ref) == entry
    assert catalog.get(None) is None
    assert await entry.handler({"invoice": "inv-1"}) == {
        "compensated": True,
        "payload": {"invoice": "inv-1"},
    }


def test_compensation_catalog_rejects_non_apex_namespace() -> None:
    compensation_catalog = load_compensation_catalog()

    catalog = compensation_catalog.CompensationCatalog()
    with pytest.raises(ValueError, match="compensation_ref_must_use_apex_namespace"):
        catalog.register(
            compensation_catalog.CompensationEntry(
                ref="third.party.rollback", owner="billing", description="invalid"
            )
        )

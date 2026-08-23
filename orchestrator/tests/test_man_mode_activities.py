"""
Unit tests for activities/man_mode.py — activity function layer.

Strategy: Import the module in isolation by mocking out:
  - temporalio.activity  (decorator + logger)
  - temporalio.exceptions.ApplicationError  (real exception class for raise/catch)
  - providers.database.factory.get_database_provider  (patched on the module)
  - policies.man_policy / models.man_mode  (real — already tested; we let them load normally)

The activity functions are called directly (not through a Temporal worker).
"""

import types
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

# ---------------------------------------------------------------------------
# Module loader
# ---------------------------------------------------------------------------


def _load_man_mode_activities():
    """
    Load activities/man_mode.py with mocked Temporal runtime.

    Returns (module, ApplicationError_class).
    """
    temporal_mod = types.ModuleType("temporalio")
    temporal_activity_mod = types.ModuleType("temporalio.activity")
    temporal_exceptions_mod = types.ModuleType("temporalio.exceptions")

    # @activity.defn — identity decorator; logger is a MagicMock
    temporal_activity_mod.defn = lambda name=None, **_kw: lambda f: f  # noqa: ARG005
    temporal_activity_mod.logger = MagicMock()

    # ApplicationError must be a real exception subclass so raise/except works
    class ApplicationError(Exception):
        def __init__(self, msg="", non_retryable=False, **_kw):  # noqa: ARG002
            super().__init__(msg)
            self.non_retryable = non_retryable

    temporal_exceptions_mod.ApplicationError = ApplicationError
    temporal_mod.activity = temporal_activity_mod
    temporal_mod.exceptions = temporal_exceptions_mod

    mocks = {
        "temporalio": temporal_mod,
        "temporalio.activity": temporal_activity_mod,
        "temporalio.exceptions": temporal_exceptions_mod,
    }

    with patch.dict("sys.modules", mocks):
        import importlib.util

        import os

        base_dir = os.path.dirname(__file__)
        activities_path = os.path.join(base_dir, "..", "activities", "man_mode.py")

        spec = importlib.util.spec_from_file_location(
            "_test_activities_man_mode",
            activities_path,
            submodule_search_locations=[],
        )
        mod = importlib.util.module_from_spec(spec)
        # Expose ApplicationError so the module's bare `raise ApplicationError(...)` works
        mod.ApplicationError = ApplicationError
        spec.loader.exec_module(mod)

    return mod, ApplicationError


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_db(upsert_result=None, update_result=None, get_result=None):
    """Return a mock async DB provider."""
    db = MagicMock()
    db.upsert = AsyncMock(return_value=upsert_result or {"id": str(uuid4())})
    db.update = AsyncMock(return_value=update_result or {"workflow_id": "wf-test"})
    db.get = AsyncMock(return_value=get_result)
    return db


# ---------------------------------------------------------------------------
# Tests: risk_triage
# ---------------------------------------------------------------------------


class TestRiskTriageActivity:
    """Tests for the risk_triage activity function."""

    @pytest.fixture(autouse=True)
    def load_mod(self):
        self.mod, self.app_error = _load_man_mode_activities()

    @pytest.mark.asyncio
    async def test_green_tool_returns_green_lane(self):
        result = await self.mod.risk_triage({"tool_name": "search_database", "workflow_id": "wf-1"})
        assert result["risk_lane"] == "GREEN"
        assert result["requires_approval"] is False

    @pytest.mark.asyncio
    async def test_sensitive_tool_returns_red_lane(self):
        result = await self.mod.risk_triage({"tool_name": "delete_record", "workflow_id": "wf-2"})
        assert result["risk_lane"] == "RED"
        assert result["requires_approval"] is True

    @pytest.mark.asyncio
    async def test_blocked_tool_returns_blocked_lane(self):
        result = await self.mod.risk_triage({"tool_name": "execute_sql_raw", "workflow_id": "wf-3"})
        assert result["risk_lane"] == "BLOCKED"

    @pytest.mark.asyncio
    async def test_irreversible_flag_forces_red(self):
        result = await self.mod.risk_triage(
            {
                "tool_name": "unknown_action",
                "workflow_id": "wf-4",
                "irreversible": True,
            }
        )
        assert result["risk_lane"] == "RED"

    @pytest.mark.asyncio
    async def test_missing_workflow_id_raises_application_error(self):
        with pytest.raises(self.app_error):
            await self.mod.risk_triage({"tool_name": "search"})

    @pytest.mark.asyncio
    async def test_empty_dict_raises_application_error(self):
        with pytest.raises(self.app_error):
            await self.mod.risk_triage({})

    @pytest.mark.asyncio
    async def test_result_contains_all_expected_keys(self):
        result = await self.mod.risk_triage({"tool_name": "search_database", "workflow_id": "wf-5"})
        for key in ("task_id", "risk_lane", "reasoning", "is_demo", "requires_approval"):
            assert key in result, f"Missing key: {key}"

    @pytest.mark.asyncio
    async def test_success_logs_info(self):
        self.mod.activity.logger.info.reset_mock()
        await self.mod.risk_triage({"tool_name": "search_database", "workflow_id": "wf-6"})
        self.mod.activity.logger.info.assert_called_once()

    @pytest.mark.asyncio
    async def test_failure_logs_error(self):
        self.mod.activity.logger.error.reset_mock()
        with pytest.raises(self.app_error):
            await self.mod.risk_triage({"not_a_valid_key": True})
        self.mod.activity.logger.error.assert_called_once()

    @pytest.mark.asyncio
    async def test_unknown_tool_returns_yellow(self):
        result = await self.mod.risk_triage(
            {
                "tool_name": "some_mystery_tool_xyz",
                "workflow_id": "wf-7",
            }
        )
        assert result["risk_lane"] == "YELLOW"

    @pytest.mark.asyncio
    async def test_application_error_is_non_retryable(self):
        """Validation failures should raise non-retryable ApplicationError."""
        try:
            await self.mod.risk_triage({})
        except self.app_error as e:
            assert e.non_retryable is True
        else:
            pytest.fail("Should have raised ApplicationError")


# ---------------------------------------------------------------------------
# Tests: create_man_task
# ---------------------------------------------------------------------------


class TestCreateManTaskActivity:
    """Tests for the create_man_task activity function."""

    @pytest.fixture(autouse=True)
    def load_mod(self):
        self.mod, self.app_error = _load_man_mode_activities()

    def _params(self, **overrides):
        base = {
            "workflow_id": "wf-create-1",
            "step_id": "step-a",
            "intent": {"tool_name": "delete_record", "workflow_id": "wf-create-1"},
            "triage_result": {"risk_lane": "RED", "reasoning": "sensitive"},
            "timeout_hours": 24,
        }
        base.update(overrides)
        return base

    @pytest.mark.asyncio
    async def test_success_returns_pending_status(self):
        task_uuid = str(uuid4())
        mock_db = _make_db(upsert_result={"id": task_uuid})
        self.mod.get_database_provider = MagicMock(return_value=mock_db)

        result = await self.mod.create_man_task(self._params())

        assert result["task_id"] == task_uuid
        assert result["status"] == "PENDING"
        assert "idempotency_key" in result

    @pytest.mark.asyncio
    async def test_provided_idempotency_key_used_as_is(self):
        task_uuid = str(uuid4())
        mock_db = _make_db(upsert_result={"id": task_uuid})
        self.mod.get_database_provider = MagicMock(return_value=mock_db)
        custom_key = "man:wf-create-1:step-a:delete_record"

        result = await self.mod.create_man_task(self._params(idempotency_key=custom_key))

        assert result["idempotency_key"] == custom_key

    @pytest.mark.asyncio
    async def test_auto_generated_idempotency_key_non_empty(self):
        mock_db = _make_db()
        self.mod.get_database_provider = MagicMock(return_value=mock_db)

        result = await self.mod.create_man_task(self._params())
        assert result["idempotency_key"] != ""

    @pytest.mark.asyncio
    async def test_upsert_called_with_man_tasks_table(self):
        mock_db = _make_db()
        self.mod.get_database_provider = MagicMock(return_value=mock_db)

        await self.mod.create_man_task(self._params())

        mock_db.upsert.assert_called_once()
        call_args = mock_db.upsert.call_args
        assert call_args.kwargs.get("table") == "man_tasks" or call_args.args[0] == "man_tasks"

    @pytest.mark.asyncio
    async def test_default_timeout_applied_when_omitted(self):
        mock_db = _make_db()
        self.mod.get_database_provider = MagicMock(return_value=mock_db)
        params = self._params()
        del params["timeout_hours"]

        result = await self.mod.create_man_task(params)
        assert result["status"] == "PENDING"

    @pytest.mark.asyncio
    async def test_missing_workflow_id_raises_error(self):
        mock_db = _make_db()
        self.mod.get_database_provider = MagicMock(return_value=mock_db)

        with pytest.raises((self.app_error, KeyError)):
            await self.mod.create_man_task({"intent": {"tool_name": "x"}})

    @pytest.mark.asyncio
    async def test_db_error_raises_retryable_application_error(self):
        mock_db = _make_db()
        mock_db.upsert = AsyncMock(side_effect=Exception("Connection timeout"))
        self.mod.get_database_provider = MagicMock(return_value=mock_db)

        with pytest.raises(self.app_error) as exc_info:
            await self.mod.create_man_task(self._params())

        assert exc_info.value.non_retryable is False

    @pytest.mark.asyncio
    async def test_application_error_from_db_re_raised_unchanged(self):
        mock_db = _make_db()
        mock_db.upsert = AsyncMock(side_effect=self.app_error("already exists", non_retryable=True))
        self.mod.get_database_provider = MagicMock(return_value=mock_db)

        with pytest.raises(self.app_error) as exc_info:
            await self.mod.create_man_task(self._params())

        assert exc_info.value.non_retryable is True

    @pytest.mark.asyncio
    async def test_success_logs_info(self):
        mock_db = _make_db()
        self.mod.get_database_provider = MagicMock(return_value=mock_db)
        self.mod.activity.logger.info.reset_mock()

        await self.mod.create_man_task(self._params())

        self.mod.activity.logger.info.assert_called_once()

    @pytest.mark.asyncio
    async def test_step_id_defaults_to_empty_string(self):
        """step_id not in params should default gracefully."""
        mock_db = _make_db()
        self.mod.get_database_provider = MagicMock(return_value=mock_db)
        params = self._params()
        del params["step_id"]

        result = await self.mod.create_man_task(params)
        assert result["status"] == "PENDING"

    @pytest.mark.asyncio
    async def test_empty_triage_result_allowed(self):
        """triage_result is optional — empty dict should work."""
        mock_db = _make_db()
        self.mod.get_database_provider = MagicMock(return_value=mock_db)
        params = self._params()
        del params["triage_result"]

        result = await self.mod.create_man_task(params)
        assert result["status"] == "PENDING"


# ---------------------------------------------------------------------------
# Tests: resolve_man_task
# ---------------------------------------------------------------------------


class TestResolveManTaskActivity:
    """Tests for the resolve_man_task activity function."""

    @pytest.fixture(autouse=True)
    def load_mod(self):
        self.mod, self.app_error = _load_man_mode_activities()

    def _params(self, status="APPROVED", **overrides):
        base = {
            "task_id": str(uuid4()),
            "status": status,
            "reason": "Looks good",
            "decided_by": "admin@example.com",
        }
        base.update(overrides)
        return base

    @pytest.mark.asyncio
    async def test_approved_returns_success_true(self):
        mock_db = _make_db(update_result={"workflow_id": "wf-res-1"})
        self.mod.get_database_provider = MagicMock(return_value=mock_db)

        result = await self.mod.resolve_man_task(self._params(status="APPROVED"))

        assert result["success"] is True
        assert result["status"] == "APPROVED"

    @pytest.mark.asyncio
    async def test_denied_returns_success_true(self):
        mock_db = _make_db(update_result={"workflow_id": "wf-res-2"})
        self.mod.get_database_provider = MagicMock(return_value=mock_db)

        result = await self.mod.resolve_man_task(self._params(status="DENIED"))

        assert result["success"] is True
        assert result["status"] == "DENIED"

    @pytest.mark.asyncio
    async def test_invalid_status_raises_non_retryable(self):
        mock_db = _make_db()
        self.mod.get_database_provider = MagicMock(return_value=mock_db)

        with pytest.raises(self.app_error) as exc_info:
            await self.mod.resolve_man_task(self._params(status="PENDING"))

        assert exc_info.value.non_retryable is True

    @pytest.mark.asyncio
    async def test_db_update_called_with_correct_table_and_filters(self):
        mock_db = _make_db(update_result={"workflow_id": "wf-res-3"})
        self.mod.get_database_provider = MagicMock(return_value=mock_db)
        params = self._params()
        task_id = params["task_id"]

        await self.mod.resolve_man_task(params)

        mock_db.update.assert_called_once()
        call_kw = mock_db.update.call_args.kwargs
        assert call_kw.get("table") == "man_tasks" or "man_tasks" in str(mock_db.update.call_args)
        assert call_kw.get("filters", {}).get("id") == task_id

    @pytest.mark.asyncio
    async def test_workflow_id_returned_from_db_result(self):
        mock_db = _make_db(update_result={"workflow_id": "wf-xyz"})
        self.mod.get_database_provider = MagicMock(return_value=mock_db)

        result = await self.mod.resolve_man_task(self._params())

        assert result["workflow_id"] == "wf-xyz"

    @pytest.mark.asyncio
    async def test_not_found_error_raises_non_retryable(self):
        mock_db = _make_db()
        mock_db.update = AsyncMock(side_effect=Exception("record not found in table"))
        self.mod.get_database_provider = MagicMock(return_value=mock_db)

        with pytest.raises(self.app_error) as exc_info:
            await self.mod.resolve_man_task(self._params())

        assert exc_info.value.non_retryable is True

    @pytest.mark.asyncio
    async def test_transient_db_error_raises_retryable(self):
        mock_db = _make_db()
        mock_db.update = AsyncMock(side_effect=Exception("Connection reset by peer"))
        self.mod.get_database_provider = MagicMock(return_value=mock_db)

        with pytest.raises(self.app_error) as exc_info:
            await self.mod.resolve_man_task(self._params())

        assert exc_info.value.non_retryable is False

    @pytest.mark.asyncio
    async def test_application_error_re_raised_unchanged(self):
        mock_db = _make_db()
        mock_db.update = AsyncMock(side_effect=self.app_error("conflict", non_retryable=True))
        self.mod.get_database_provider = MagicMock(return_value=mock_db)

        with pytest.raises(self.app_error) as exc_info:
            await self.mod.resolve_man_task(self._params())

        assert exc_info.value.non_retryable is True

    @pytest.mark.asyncio
    async def test_optional_reason_and_metadata_omitted(self):
        mock_db = _make_db(update_result={"workflow_id": ""})
        self.mod.get_database_provider = MagicMock(return_value=mock_db)
        params = {"task_id": str(uuid4()), "status": "APPROVED"}

        result = await self.mod.resolve_man_task(params)
        assert result["success"] is True

    @pytest.mark.asyncio
    async def test_success_logs_info(self):
        mock_db = _make_db(update_result={"workflow_id": "wf-log"})
        self.mod.get_database_provider = MagicMock(return_value=mock_db)
        self.mod.activity.logger.info.reset_mock()

        await self.mod.resolve_man_task(self._params())

        self.mod.activity.logger.info.assert_called_once()

    @pytest.mark.asyncio
    async def test_failure_logs_error(self):
        mock_db = _make_db()
        mock_db.update = AsyncMock(side_effect=Exception("boom"))
        self.mod.get_database_provider = MagicMock(return_value=mock_db)
        self.mod.activity.logger.error.reset_mock()

        with pytest.raises(self.app_error):
            await self.mod.resolve_man_task(self._params())

        self.mod.activity.logger.error.assert_called_once()

    @pytest.mark.asyncio
    async def test_task_id_returned_in_result(self):
        mock_db = _make_db(update_result={"workflow_id": "wf-1"})
        self.mod.get_database_provider = MagicMock(return_value=mock_db)
        params = self._params()
        task_id = params["task_id"]

        result = await self.mod.resolve_man_task(params)
        assert result["task_id"] == task_id


# ---------------------------------------------------------------------------
# Tests: get_man_task
# ---------------------------------------------------------------------------


class TestGetManTaskActivity:
    """Tests for the get_man_task activity function."""

    @pytest.fixture(autouse=True)
    def load_mod(self):
        self.mod, self.app_error = _load_man_mode_activities()

    @pytest.mark.asyncio
    async def test_lookup_by_task_id_found(self):
        task_id = str(uuid4())
        task_data = {"id": task_id, "status": "PENDING", "workflow_id": "wf-get-1"}
        mock_db = _make_db(get_result=[task_data])
        self.mod.get_database_provider = MagicMock(return_value=mock_db)

        result = await self.mod.get_man_task({"task_id": task_id})

        assert result["found"] is True
        assert result["task"]["id"] == task_id

    @pytest.mark.asyncio
    async def test_lookup_by_idempotency_key_found(self):
        key = "man:wf-1:step-1:delete"
        task_data = {"id": str(uuid4()), "status": "PENDING"}
        mock_db = _make_db(get_result=[task_data])
        self.mod.get_database_provider = MagicMock(return_value=mock_db)

        result = await self.mod.get_man_task({"idempotency_key": key})

        assert result["found"] is True

    @pytest.mark.asyncio
    async def test_empty_result_returns_found_false(self):
        mock_db = _make_db(get_result=[])
        self.mod.get_database_provider = MagicMock(return_value=mock_db)

        result = await self.mod.get_man_task({"task_id": str(uuid4())})

        assert result["found"] is False
        assert result["task"] is None

    @pytest.mark.asyncio
    async def test_no_params_raises_non_retryable(self):
        mock_db = _make_db()
        self.mod.get_database_provider = MagicMock(return_value=mock_db)

        with pytest.raises(self.app_error) as exc_info:
            await self.mod.get_man_task({})

        assert exc_info.value.non_retryable is True

    @pytest.mark.asyncio
    async def test_db_error_raises_retryable(self):
        mock_db = _make_db()
        mock_db.get = AsyncMock(side_effect=Exception("DB unavailable"))
        self.mod.get_database_provider = MagicMock(return_value=mock_db)

        with pytest.raises(self.app_error) as exc_info:
            await self.mod.get_man_task({"task_id": str(uuid4())})

        assert exc_info.value.non_retryable is False

    @pytest.mark.asyncio
    async def test_application_error_re_raised(self):
        mock_db = _make_db()
        mock_db.get = AsyncMock(side_effect=self.app_error("custom", non_retryable=True))
        self.mod.get_database_provider = MagicMock(return_value=mock_db)

        with pytest.raises(self.app_error) as exc_info:
            await self.mod.get_man_task({"task_id": str(uuid4())})

        assert exc_info.value.non_retryable is True

    @pytest.mark.asyncio
    async def test_query_filtered_by_task_id(self):
        task_id = str(uuid4())
        mock_db = _make_db(get_result=[{"id": task_id, "status": "PENDING"}])
        self.mod.get_database_provider = MagicMock(return_value=mock_db)

        await self.mod.get_man_task({"task_id": task_id})

        call_kw = mock_db.get.call_args.kwargs
        assert call_kw.get("query_params", {}).get("id") == task_id

    @pytest.mark.asyncio
    async def test_query_filtered_by_idempotency_key(self):
        ikey = "man:wf:step:tool"
        mock_db = _make_db(get_result=[{"id": str(uuid4()), "status": "PENDING"}])
        self.mod.get_database_provider = MagicMock(return_value=mock_db)

        await self.mod.get_man_task({"idempotency_key": ikey})

        call_kw = mock_db.get.call_args.kwargs
        assert call_kw.get("query_params", {}).get("idempotency_key") == ikey

    @pytest.mark.asyncio
    async def test_first_result_is_returned(self):
        task1 = {"id": "id-1", "status": "PENDING"}
        task2 = {"id": "id-2", "status": "APPROVED"}
        mock_db = _make_db(get_result=[task1, task2])
        self.mod.get_database_provider = MagicMock(return_value=mock_db)

        result = await self.mod.get_man_task({"task_id": "id-1"})

        assert result["task"]["id"] == "id-1"

    @pytest.mark.asyncio
    async def test_task_id_filter_takes_priority_over_idempotency_key(self):
        """When both provided, task_id should be used."""
        task_id = str(uuid4())
        mock_db = _make_db(get_result=[{"id": task_id, "status": "PENDING"}])
        self.mod.get_database_provider = MagicMock(return_value=mock_db)

        result = await self.mod.get_man_task({"task_id": task_id, "idempotency_key": "some-key"})
        call_kw = mock_db.get.call_args.kwargs
        assert call_kw.get("query_params", {}).get("id") == task_id
        assert result["found"] is True


# ---------------------------------------------------------------------------
# Tests: check_man_decision
# ---------------------------------------------------------------------------


class TestCheckManDecisionActivity:
    """Tests for the check_man_decision activity function."""

    @pytest.fixture(autouse=True)
    def load_mod(self):
        self.mod, self.app_error = _load_man_mode_activities()

    @pytest.mark.asyncio
    async def test_task_not_found_returns_decided_false(self):
        mock_db = _make_db(get_result=[])
        self.mod.get_database_provider = MagicMock(return_value=mock_db)

        result = await self.mod.check_man_decision({"task_id": str(uuid4())})

        assert result["decided"] is False
        assert result["reason"] == "Task not found"
        assert result["status"] is None

    @pytest.mark.asyncio
    async def test_pending_task_returns_decided_false(self):
        task_id = str(uuid4())
        mock_db = _make_db(get_result=[{"id": task_id, "status": "PENDING"}])
        self.mod.get_database_provider = MagicMock(return_value=mock_db)

        result = await self.mod.check_man_decision({"task_id": task_id})

        assert result["decided"] is False
        assert result["status"] is None
        assert result["reason"] is None

    @pytest.mark.asyncio
    async def test_approved_task_returns_decided_true(self):
        task_id = str(uuid4())
        task_data = {
            "id": task_id,
            "status": "APPROVED",
            "decision": {"reason": "All good"},
        }
        mock_db = _make_db(get_result=[task_data])
        self.mod.get_database_provider = MagicMock(return_value=mock_db)

        result = await self.mod.check_man_decision({"task_id": task_id})

        assert result["decided"] is True
        assert result["status"] == "APPROVED"
        assert result["reason"] == "All good"

    @pytest.mark.asyncio
    async def test_denied_task_returns_decided_true(self):
        task_id = str(uuid4())
        task_data = {
            "id": task_id,
            "status": "DENIED",
            "decision": {"reason": "Too risky"},
        }
        mock_db = _make_db(get_result=[task_data])
        self.mod.get_database_provider = MagicMock(return_value=mock_db)

        result = await self.mod.check_man_decision({"task_id": task_id})

        assert result["decided"] is True
        assert result["status"] == "DENIED"
        assert result["reason"] == "Too risky"

    @pytest.mark.asyncio
    async def test_null_decision_field_reason_is_none(self):
        task_id = str(uuid4())
        task_data = {"id": task_id, "status": "APPROVED", "decision": None}
        mock_db = _make_db(get_result=[task_data])
        self.mod.get_database_provider = MagicMock(return_value=mock_db)

        result = await self.mod.check_man_decision({"task_id": task_id})

        assert result["decided"] is True
        assert result["reason"] is None

    @pytest.mark.asyncio
    async def test_expired_task_returns_decided_true(self):
        task_id = str(uuid4())
        task_data = {
            "id": task_id,
            "status": "EXPIRED",
            "decision": {"reason": "timed out"},
        }
        mock_db = _make_db(get_result=[task_data])
        self.mod.get_database_provider = MagicMock(return_value=mock_db)

        result = await self.mod.check_man_decision({"task_id": task_id})

        assert result["decided"] is True
        assert result["status"] == "EXPIRED"

    @pytest.mark.asyncio
    async def test_db_error_raises_application_error(self):
        mock_db = _make_db()
        mock_db.get = AsyncMock(side_effect=Exception("Timeout"))
        self.mod.get_database_provider = MagicMock(return_value=mock_db)

        with pytest.raises(self.app_error):
            await self.mod.check_man_decision({"task_id": str(uuid4())})

    @pytest.mark.asyncio
    async def test_no_params_raises_application_error(self):
        mock_db = _make_db()
        self.mod.get_database_provider = MagicMock(return_value=mock_db)

        with pytest.raises(self.app_error):
            await self.mod.check_man_decision({})

    @pytest.mark.asyncio
    async def test_missing_decision_key_in_task(self):
        """Task without 'decision' key should return reason=None when decided."""
        task_id = str(uuid4())
        task_data = {"id": task_id, "status": "APPROVED"}  # no 'decision' key
        mock_db = _make_db(get_result=[task_data])
        self.mod.get_database_provider = MagicMock(return_value=mock_db)

        result = await self.mod.check_man_decision({"task_id": task_id})

        assert result["decided"] is True
        assert result["reason"] is None


# ---------------------------------------------------------------------------
# Tests: PolicyDecision model (defined in activities/man_mode.py)
# ---------------------------------------------------------------------------


class TestPolicyDecisionModel:
    """Test the PolicyDecision Pydantic model."""

    @pytest.fixture(autouse=True)
    def load_mod(self):
        self.mod, _ = _load_man_mode_activities()

    def test_allow_green_lane(self):
        pd = self.mod.PolicyDecision(
            decision="ALLOW",
            lane="GREEN",
            reason="Safe operation",
            policy_source="man_policy",
        )
        assert pd.decision == "ALLOW"
        assert pd.lane == "GREEN"
        assert pd.required_scopes == []

    def test_deny_blocked_lane(self):
        pd = self.mod.PolicyDecision(
            decision="DENY",
            lane="BLOCKED",
            reason="Blocked tool",
            policy_source="iron_law",
        )
        assert pd.decision == "DENY"
        assert pd.lane == "BLOCKED"

    def test_defer_yellow_lane(self):
        pd = self.mod.PolicyDecision(
            decision="DEFER",
            lane="YELLOW",
            reason="Needs review",
            policy_source="omnipolicy",
        )
        assert pd.decision == "DEFER"

    def test_required_scopes_accepted(self):
        pd = self.mod.PolicyDecision(
            decision="ALLOW",
            lane="GREEN",
            reason="OK",
            policy_source="man_policy",
            required_scopes=["read:db", "write:db"],
        )
        assert pd.required_scopes == ["read:db", "write:db"]

    def test_all_policy_sources_accepted(self):
        for source in ("omnipolicy", "man_policy", "iron_law"):
            pd = self.mod.PolicyDecision(
                decision="ALLOW",
                lane="GREEN",
                reason="ok",
                policy_source=source,
            )
            assert pd.policy_source == source

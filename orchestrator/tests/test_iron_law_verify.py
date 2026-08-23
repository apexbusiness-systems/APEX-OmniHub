"""
Tests for activities/iron_law_verify.py — 100% line coverage.

All subprocess interactions are mocked so no Node.js installation is required.
"""

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from temporalio import activity
from temporalio.exceptions import ApplicationError

from activities.iron_law_verify import verify_deductive_path

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_VERIFIED_OK = json.dumps(
    {
        "verified": True,
        "logicDelta": 0.1,
        "escalateToMan": False,
        "reason": "Deductive path verified",
    }
).encode()

_VERIFIED_FAIL = json.dumps(
    {
        "verified": False,
        "logicDelta": 0.9,
        "escalateToMan": True,
        "reason": "threshold exceeded",
    }
).encode()


def _proc(returncode: int = 0, stdout: bytes = b"", stderr: bytes = b"") -> MagicMock:
    p = MagicMock()
    p.returncode = returncode
    p.communicate = AsyncMock(return_value=(stdout, stderr))
    p.kill = MagicMock()
    p.wait = AsyncMock()
    return p


@pytest.fixture(autouse=True)
def _mock_logger():
    with patch.object(activity, "logger", MagicMock()):
        yield


# ---------------------------------------------------------------------------
# Happy paths
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_iron_law_verify_success_verified_true():
    """Subprocess returns verified=True — full param set."""
    proc = _proc(stdout=_VERIFIED_OK)
    with patch("asyncio.create_subprocess_exec", new_callable=AsyncMock, return_value=proc):
        result = await verify_deductive_path(
            {
                "intent": "open_door",
                "target_state": {"door": "open"},
                "device_id": "door-123",
                "workflow_id": "wf-123",
            }
        )
    assert result["verified"] is True
    assert result["logicDelta"] == pytest.approx(0.1)
    assert result["escalateToMan"] is False


@pytest.mark.asyncio
async def test_iron_law_verify_success_verified_false():
    """Subprocess returns verified=False with escalate flag."""
    proc = _proc(stdout=_VERIFIED_FAIL)
    with patch("asyncio.create_subprocess_exec", new_callable=AsyncMock, return_value=proc):
        result = await verify_deductive_path({"intent": "x", "device_id": "d", "workflow_id": "w"})
    assert result["verified"] is False
    assert result["escalateToMan"] is True


@pytest.mark.asyncio
async def test_iron_law_verify_empty_params():
    """Defaults are used when the params dict is empty."""
    proc = _proc(stdout=_VERIFIED_OK)
    with patch("asyncio.create_subprocess_exec", new_callable=AsyncMock, return_value=proc):
        result = await verify_deductive_path({})
    assert "verified" in result


# ---------------------------------------------------------------------------
# Error paths
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_iron_law_verify_timeout():
    """Subprocess times out → ApplicationError(non_retryable=False)."""
    proc = MagicMock()
    proc.communicate = AsyncMock(side_effect=TimeoutError("timed out"))
    proc.kill = MagicMock()
    proc.wait = AsyncMock()

    with patch("asyncio.create_subprocess_exec", new_callable=AsyncMock, return_value=proc):
        with pytest.raises(ApplicationError) as exc_info:
            await verify_deductive_path({"intent": "x", "device_id": "d", "workflow_id": "w"})

    assert "timeout" in str(exc_info.value).lower()
    assert exc_info.value.non_retryable is False
    proc.kill.assert_called_once()


@pytest.mark.asyncio
async def test_iron_law_verify_subprocess_error_with_stderr():
    """Non-zero return code with stderr → ApplicationError(non_retryable=False)."""
    proc = _proc(returncode=1, stderr=b"SyntaxError: unexpected token")
    with patch("asyncio.create_subprocess_exec", new_callable=AsyncMock, return_value=proc):
        with pytest.raises(ApplicationError) as exc_info:
            await verify_deductive_path({"intent": "x", "device_id": "d", "workflow_id": "w"})
    assert "SyntaxError" in str(exc_info.value)
    assert exc_info.value.non_retryable is False


@pytest.mark.asyncio
async def test_iron_law_verify_subprocess_error_empty_stderr():
    """Non-zero return code with empty stderr → error still raised."""
    proc = _proc(returncode=2, stderr=b"")
    with patch("asyncio.create_subprocess_exec", new_callable=AsyncMock, return_value=proc):
        with pytest.raises(ApplicationError) as exc_info:
            await verify_deductive_path({"intent": "x", "device_id": "d", "workflow_id": "w"})
    assert exc_info.value.non_retryable is False


@pytest.mark.asyncio
async def test_iron_law_verify_json_decode_error():
    """Invalid JSON from subprocess → ApplicationError(non_retryable=True)."""
    proc = _proc(returncode=0, stdout=b"not-json-at-all!!!")
    with patch("asyncio.create_subprocess_exec", new_callable=AsyncMock, return_value=proc):
        with pytest.raises(ApplicationError) as exc_info:
            await verify_deductive_path({"intent": "x", "device_id": "d", "workflow_id": "w"})
    assert "parsing failed" in str(exc_info.value).lower()
    assert exc_info.value.non_retryable is True


@pytest.mark.asyncio
async def test_iron_law_verify_generic_os_error():
    """OS-level failure launching subprocess → ApplicationError(non_retryable=False)."""
    with patch(
        "asyncio.create_subprocess_exec", side_effect=OSError("no such file: /usr/bin/node")
    ):
        with pytest.raises(ApplicationError) as exc_info:
            await verify_deductive_path({"intent": "x", "device_id": "d", "workflow_id": "w"})
    assert exc_info.value.non_retryable is False
    assert "no such file" in str(exc_info.value).lower()

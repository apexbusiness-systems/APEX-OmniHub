"""
Tests for omega/dashboard.py

Covers the XSS-safe (S5131-compliant) methods:
- _handle_approve
- _handle_reject
- _handle_get_pending
- _send_error
- _sanitize_request_id
- _sanitize_username
"""

import io
import json
from unittest.mock import MagicMock

import pytest

from omega.dashboard import VerificationDashboardHandler


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------


def _make_handler(engine: MagicMock | None = None) -> VerificationDashboardHandler:
    """
    Build a VerificationDashboardHandler without starting an HTTP server.

    We bypass BaseHTTPRequestHandler.__init__ (which dispatches handle()) and
    instead inject only the attributes our unit-tests exercise.
    """
    handler: VerificationDashboardHandler = object.__new__(VerificationDashboardHandler)
    handler.engine = engine if engine is not None else MagicMock()
    handler.wfile = io.BytesIO()
    # Mock HTTP response helpers so tests don't need a real socket
    handler.send_response = MagicMock()  # type: ignore[method-assign]
    handler.send_header = MagicMock()  # type: ignore[method-assign]
    handler.end_headers = MagicMock()  # type: ignore[method-assign]
    return handler


def _response_body(handler: VerificationDashboardHandler) -> dict:
    """Parse the JSON written to handler.wfile."""
    handler.wfile.seek(0)
    return json.loads(handler.wfile.read().decode("utf-8"))


# ---------------------------------------------------------------------------
# _handle_approve
# ---------------------------------------------------------------------------


class TestHandleApprove:
    def test_approve_returns_fixed_status(self) -> None:
        engine = MagicMock()
        handler = _make_handler(engine)
        handler._handle_approve({"request_id": "req-abc123", "approved_by": "alice"})

        body = _response_body(handler)
        assert body == {"status": "approved"}

    def test_approve_calls_engine_approve(self) -> None:
        engine = MagicMock()
        handler = _make_handler(engine)
        handler._handle_approve({"request_id": "req-def456", "approved_by": "bob"})

        engine.approve_request.assert_called_once_with("req-def456", "bob")

    def test_approve_sends_json_content_type(self) -> None:
        engine = MagicMock()
        handler = _make_handler(engine)
        handler._handle_approve({"request_id": "req-abc123", "approved_by": "alice"})

        calls = [str(c) for c in handler.send_header.call_args_list]
        assert any("application/json" in c for c in calls)

    def test_approve_raises_on_invalid_request_id(self) -> None:
        handler = _make_handler()
        with pytest.raises(ValueError, match="Invalid request ID"):
            handler._handle_approve({"request_id": "<script>", "approved_by": "alice"})

    def test_approve_raises_on_invalid_username(self) -> None:
        handler = _make_handler()
        with pytest.raises(ValueError, match="Invalid username"):
            handler._handle_approve({"request_id": "req-abc123", "approved_by": "<bad>"})


# ---------------------------------------------------------------------------
# _handle_reject
# ---------------------------------------------------------------------------


class TestHandleReject:
    def test_reject_returns_fixed_status(self) -> None:
        engine = MagicMock()
        handler = _make_handler(engine)
        handler._handle_reject(
            {
                "request_id": "req-xyz789",
                "rejected_by": "carol",
                "reason": "policy",
            }
        )

        body = _response_body(handler)
        assert body == {"status": "rejected"}

    def test_reject_calls_engine_reject(self) -> None:
        engine = MagicMock()
        handler = _make_handler(engine)
        handler._handle_reject(
            {
                "request_id": "req-xyz789",
                "rejected_by": "carol",
                "reason": "out of scope",
            }
        )

        engine.reject_request.assert_called_once_with("req-xyz789", "carol", "out of scope")

    def test_reject_with_empty_reason(self) -> None:
        engine = MagicMock()
        handler = _make_handler(engine)
        handler._handle_reject({"request_id": "req-abc123", "rejected_by": "dave"})

        engine.reject_request.assert_called_once_with("req-abc123", "dave", "")

    def test_reject_sends_json_content_type(self) -> None:
        engine = MagicMock()
        handler = _make_handler(engine)
        handler._handle_reject({"request_id": "req-abc123", "rejected_by": "carol", "reason": ""})

        calls = [str(c) for c in handler.send_header.call_args_list]
        assert any("application/json" in c for c in calls)

    def test_reject_raises_on_invalid_request_id(self) -> None:
        handler = _make_handler()
        with pytest.raises(ValueError, match="Invalid request ID"):
            handler._handle_reject({"request_id": "!!!bad!!!", "rejected_by": "carol"})

    def test_reject_raises_on_invalid_username(self) -> None:
        handler = _make_handler()
        with pytest.raises(ValueError, match="Invalid username"):
            handler._handle_reject({"request_id": "req-abc123", "rejected_by": "<xss>"})


# ---------------------------------------------------------------------------
# _handle_get_pending
# ---------------------------------------------------------------------------


class TestHandleGetPending:
    def test_get_pending_returns_escaped_strings(self) -> None:
        engine = MagicMock()
        engine.get_pending_requests.return_value = {
            "req-001": {
                "task_description": "<script>alert(1)</script>",
                "status": "pending",
                "count": 42,  # non-string values pass through unchanged
            }
        }
        handler = _make_handler(engine)
        handler._handle_get_pending()

        body = _response_body(handler)
        # XSS payload must be escaped
        assert "<script>" not in body["req-001"]["task_description"]
        assert "&lt;script&gt;" in body["req-001"]["task_description"]
        # Non-string values are preserved
        assert body["req-001"]["count"] == 42

    def test_get_pending_empty_dict(self) -> None:
        engine = MagicMock()
        engine.get_pending_requests.return_value = {}
        handler = _make_handler(engine)
        handler._handle_get_pending()

        body = _response_body(handler)
        assert body == {}

    def test_get_pending_sends_json_content_type(self) -> None:
        engine = MagicMock()
        engine.get_pending_requests.return_value = {}
        handler = _make_handler(engine)
        handler._handle_get_pending()

        calls = [str(c) for c in handler.send_header.call_args_list]
        assert any("application/json" in c for c in calls)

    def test_get_pending_sets_nosniff_header(self) -> None:
        engine = MagicMock()
        engine.get_pending_requests.return_value = {}
        handler = _make_handler(engine)
        handler._handle_get_pending()

        calls = [str(c) for c in handler.send_header.call_args_list]
        assert any("nosniff" in c for c in calls)


# ---------------------------------------------------------------------------
# _send_error
# ---------------------------------------------------------------------------


class TestSendError:
    def test_send_error_escapes_message(self) -> None:
        handler = _make_handler()
        handler._send_error(400, "<script>xss</script>")

        handler.wfile.seek(0)
        raw = handler.wfile.read().decode("utf-8")
        assert "<script>" not in raw
        assert "&lt;script&gt;" in raw

    def test_send_error_sends_correct_http_code(self) -> None:
        handler = _make_handler()
        handler._send_error(404, "Not Found")

        handler.send_response.assert_called_once_with(404)

    def test_send_error_sends_json_content_type(self) -> None:
        handler = _make_handler()
        handler._send_error(500, "Internal Server Error")

        calls = [str(c) for c in handler.send_header.call_args_list]
        assert any("application/json" in c for c in calls)

    def test_send_error_sets_nosniff_header(self) -> None:
        handler = _make_handler()
        handler._send_error(400, "Bad Request")

        calls = [str(c) for c in handler.send_header.call_args_list]
        assert any("nosniff" in c for c in calls)

    def test_send_error_response_has_error_key(self) -> None:
        handler = _make_handler()
        handler._send_error(400, "Bad Request")

        body = _response_body(handler)
        assert "error" in body


# ---------------------------------------------------------------------------
# _sanitize_request_id
# ---------------------------------------------------------------------------


class TestSanitizeRequestId:
    def test_valid_alphanumeric_id(self) -> None:
        handler = _make_handler()
        assert handler._sanitize_request_id("req-abc123") == "req-abc123"

    def test_valid_uuid_style_id(self) -> None:
        handler = _make_handler()
        uid = "550e8400-e29b-41d4-a716-446655440000"
        assert handler._sanitize_request_id(uid) == uid

    def test_raises_on_empty_id(self) -> None:
        handler = _make_handler()
        with pytest.raises(ValueError, match="Invalid request ID"):
            handler._sanitize_request_id("")

    def test_raises_on_special_chars(self) -> None:
        handler = _make_handler()
        with pytest.raises(ValueError, match="Invalid request ID"):
            handler._sanitize_request_id("<script>")

    def test_raises_when_too_long(self) -> None:
        handler = _make_handler()
        with pytest.raises(ValueError, match="Request ID too long"):
            handler._sanitize_request_id("a" * 65)

    def test_accepts_max_length_id(self) -> None:
        handler = _make_handler()
        long_id = "a" * 64
        assert handler._sanitize_request_id(long_id) == long_id


# ---------------------------------------------------------------------------
# _sanitize_username
# ---------------------------------------------------------------------------


class TestSanitizeUsername:
    def test_valid_email_style_username(self) -> None:
        handler = _make_handler()
        assert handler._sanitize_username("alice@example.com") == "alice@example.com"

    def test_valid_simple_username(self) -> None:
        handler = _make_handler()
        assert handler._sanitize_username("alice") == "alice"

    def test_valid_username_with_dots_dashes(self) -> None:
        handler = _make_handler()
        assert handler._sanitize_username("alice.b-smith") == "alice.b-smith"

    def test_raises_on_empty_username(self) -> None:
        handler = _make_handler()
        with pytest.raises(ValueError, match="Invalid username"):
            handler._sanitize_username("")

    def test_raises_on_xss_payload(self) -> None:
        handler = _make_handler()
        with pytest.raises(ValueError, match="Invalid username"):
            handler._sanitize_username("<script>alert(1)</script>")

    def test_raises_when_too_long(self) -> None:
        handler = _make_handler()
        with pytest.raises(ValueError, match="Username too long"):
            handler._sanitize_username("a" * 101)

    def test_accepts_max_length_username(self) -> None:
        handler = _make_handler()
        long_username = "a" * 100
        assert handler._sanitize_username(long_username) == long_username

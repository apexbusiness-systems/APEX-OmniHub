"""
Unit tests for PhysiOmni Phase 2 intelligence layer & orchestration saga.

Covers:
1. activities/physiomni_activities.py (100% coverage goal)
2. workflows/physiomni_saga.py (100% coverage goal)
"""

import os
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4
import pytest
from temporalio.exceptions import ApplicationError

# Import activities in isolation by patching temporal/database boundaries
with patch("temporalio.activity.defn", lambda _name=None, **_kw: lambda f: f):
    with patch("providers.database.factory.get_database_provider") as mock_get_db:
        from activities.physiomni_activities import (
            compute_14_day_baseline,
            evaluate_baseline,
            evaluate_baseline_activity,
            log_physiomni_alert,
            man_mode_escalation_activity,
            dispatch_work_order_activity,
        )


# ---------------------------------------------------------------------------
# HELPERS
# ---------------------------------------------------------------------------
def _make_db_mock():
    db = MagicMock()
    db.select = AsyncMock(return_value=[])
    db.insert = AsyncMock(return_value={"id": str(uuid4())})
    db.update = AsyncMock(return_value={"id": str(uuid4())})
    db.upsert = AsyncMock(return_value={"id": str(uuid4())})
    return db


# ---------------------------------------------------------------------------
# TESTS: compute_14_day_baseline
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_compute_14_day_baseline_empty_telemetry():
    """Fallback standard envelopes should be saved when telemetry is empty."""
    db = _make_db_mock()
    # Mock direct client table chain
    client_mock = MagicMock()
    db.client = client_mock

    # Mock existing baselines lookup returns empty data
    existing_resp = MagicMock()
    existing_resp.data = []

    # Mock telemetry lookup returns empty data
    telemetry_resp = MagicMock()
    telemetry_resp.data = []

    def mock_table(table_name):
        table_mock = MagicMock()
        if table_name == "physiomni_telemetry":
            table_mock.select.return_value.eq.return_value.eq.return_value.gte.return_value.execute = MagicMock(
                return_value=telemetry_resp
            )
        elif table_name == "physiomni_baselines":
            table_mock.select.return_value.eq.return_value.execute = MagicMock(
                return_value=existing_resp
            )
        return table_mock

    client_mock.table.side_effect = mock_table

    with patch("activities.physiomni_activities.get_database_provider", return_value=db):
        params = {
            "device_id": str(uuid4()),
            "tenant_id": str(uuid4()),
            "device_serial": "DEV-TEST-100",
            "asset_class": "industrial_pump",
        }
        result = await compute_14_day_baseline(params)
        assert result["success"] is True
        assert result["device_serial"] == "DEV-TEST-100"
        assert result["envelope"]["rms_envelope"]["x"] == pytest.approx(1.2)
        assert result["envelope"]["peak_envelope"]["y"] == pytest.approx(2.5)


@pytest.mark.asyncio
async def test_compute_14_day_baseline_with_records():
    """RMS and Peak envelopes should be computed accurately from telemetry rows."""
    db = _make_db_mock()
    client_mock = MagicMock()
    db.client = client_mock

    # Mock telemetry records
    records = [
        {
            "vibration_x": 1.0,
            "vibration_y": 2.0,
            "vibration_z": 3.0,
            "temperature_c": 40.0,
            "captured_at": "2026-05-26T00:00:00Z",
        },
        {
            "vibration_x": 2.0,
            "vibration_y": -4.0,
            "vibration_z": 6.0,
            "temperature_c": 42.0,
            "captured_at": "2026-05-26T01:00:00Z",
        },
    ]
    telemetry_resp = MagicMock()
    telemetry_resp.data = records

    # Mock existing baseline found
    existing_resp = MagicMock()
    existing_resp.data = [{"id": "baseline-uuid-123"}]

    def mock_table(table_name):
        table_mock = MagicMock()
        if table_name == "physiomni_telemetry":
            table_mock.select.return_value.eq.return_value.eq.return_value.gte.return_value.execute = MagicMock(
                return_value=telemetry_resp
            )
        elif table_name == "physiomni_baselines":
            table_mock.select.return_value.eq.return_value.execute = MagicMock(
                return_value=existing_resp
            )
        return table_mock

    client_mock.table.side_effect = mock_table

    with patch("activities.physiomni_activities.get_database_provider", return_value=db):
        params = {
            "device_id": str(uuid4()),
            "tenant_id": str(uuid4()),
            "device_serial": "DEV-TEST-101",
        }
        result = await compute_14_day_baseline(params)
        assert result["success"] is True
        assert result["envelope"]["sample_count"] == 2
        # Check Root Mean Square formula correctness
        assert result["envelope"]["rms_envelope"]["x"] == pytest.approx(1.5811, abs=1e-4)
        # Peak envelope calculation check
        assert result["envelope"]["peak_envelope"]["y"] == pytest.approx(4.0)


@pytest.mark.asyncio
async def test_compute_14_day_baseline_error():
    """An ApplicationError should be raised on database client failures."""
    db = _make_db_mock()
    client_mock = MagicMock()
    client_mock.table.side_effect = Exception("Database connection failure")
    db.client = client_mock

    with patch("activities.physiomni_activities.get_database_provider", return_value=db):
        with pytest.raises(ApplicationError):
            await compute_14_day_baseline(
                {
                    "device_id": "x",
                    "tenant_id": "y",
                    "device_serial": "z",
                }
            )


# ---------------------------------------------------------------------------
# TESTS: evaluate_baseline
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_evaluate_baseline_device_not_found():
    """NOMINAL safety bounds returned when device not found."""
    db = _make_db_mock()
    client_mock = MagicMock()
    db.client = client_mock

    dev_resp = MagicMock()
    dev_resp.data = []
    client_mock.table.return_value.select.return_value.eq.return_value.eq.return_value.execute.return_value = dev_resp

    with patch("activities.physiomni_activities.get_database_provider", return_value=db):
        payload = {
            "device_serial": "DEV-NOT-HERE",
            "tenant_id": str(uuid4()),
            "vibration_x": 1.0,
            "vibration_y": 1.0,
            "vibration_z": 1.0,
        }
        result = await evaluate_baseline(payload)
        assert result["deviation_exceeded"] is False
        assert "Device registration record not found" in result["reason"]


@pytest.mark.asyncio
async def test_evaluate_baseline_no_baseline_profile():
    """Default limits should be used when baseline profile is missing."""
    db = _make_db_mock()
    client_mock = MagicMock()
    db.client = client_mock

    # Device found
    dev_resp = MagicMock()
    dev_resp.data = [{"id": str(uuid4())}]
    # Baseline empty
    baseline_resp = MagicMock()
    baseline_resp.data = []

    def mock_table(table_name):
        table_mock = MagicMock()
        if table_name == "physiomni_devices":
            table_mock.select.return_value.eq.return_value.eq.return_value.execute = MagicMock(
                return_value=dev_resp
            )
        elif table_name == "physiomni_baselines":
            table_mock.select.return_value.eq.return_value.execute = MagicMock(
                return_value=baseline_resp
            )
        return table_mock

    client_mock.table.side_effect = mock_table

    with patch("activities.physiomni_activities.get_database_provider", return_value=db):
        payload = {
            "device_serial": "DEV-TEST-102",
            "tenant_id": str(uuid4()),
            "vibration_x": 20.0,  # Exceeds default limit (12.0 * 1.5 = 18.0)
            "vibration_y": 1.0,
            "vibration_z": 1.0,
            "anomaly_score": 0.85,
        }
        result = await evaluate_baseline(payload)
        assert result["deviation_exceeded"] is True
        assert result["escalation_required"] is True
        assert result["guardian_confidence"] == pytest.approx(0.85)


@pytest.mark.asyncio
async def test_evaluate_baseline_within_baseline():
    """NOMINAL status should be returned when vibration is within 1.5x of peak envelope."""
    db = _make_db_mock()
    client_mock = MagicMock()
    db.client = client_mock

    dev_resp = MagicMock()
    dev_resp.data = [{"id": str(uuid4())}]

    baseline_resp = MagicMock()
    baseline_resp.data = [{"normal_envelope": {"peak_envelope": {"x": 5.0, "y": 5.0, "z": 5.0}}}]

    def mock_table(table_name):
        table_mock = MagicMock()
        if table_name == "physiomni_devices":
            table_mock.select.return_value.eq.return_value.eq.return_value.execute = MagicMock(
                return_value=dev_resp
            )
        elif table_name == "physiomni_baselines":
            table_mock.select.return_value.eq.return_value.execute = MagicMock(
                return_value=baseline_resp
            )
        return table_mock

    client_mock.table.side_effect = mock_table

    with patch("activities.physiomni_activities.get_database_provider", return_value=db):
        payload = {
            "device_serial": "DEV-TEST-103",
            "tenant_id": str(uuid4()),
            "vibration_x": 7.0,  # Within 7.5 limit (5.0 * 1.5)
            "vibration_y": 2.0,
            "vibration_z": 3.0,
            "anomaly_score": 0.50,
        }
        result = await evaluate_baseline_activity(payload)
        assert result["deviation_exceeded"] is False
        assert result["guardian_confidence"] == pytest.approx(0.96)


@pytest.mark.asyncio
async def test_evaluate_baseline_confidence_bounds():
    """Guardian confidence should scale dynamically with high anomaly scores."""
    db = _make_db_mock()
    client_mock = MagicMock()
    db.client = client_mock

    dev_resp = MagicMock()
    dev_resp.data = [{"id": str(uuid4())}]
    baseline_resp = MagicMock()
    baseline_resp.data = [{"normal_envelope": {"peak_envelope": {"x": 2.0, "y": 2.0, "z": 2.0}}}]

    def mock_table(table_name):
        table_mock = MagicMock()
        if table_name == "physiomni_devices":
            table_mock.select.return_value.eq.return_value.eq.return_value.execute = MagicMock(
                return_value=dev_resp
            )
        elif table_name == "physiomni_baselines":
            table_mock.select.return_value.eq.return_value.execute = MagicMock(
                return_value=baseline_resp
            )
        return table_mock

    client_mock.table.side_effect = mock_table

    with patch("activities.physiomni_activities.get_database_provider", return_value=db):
        payload = {
            "device_serial": "DEV-TEST-104",
            "tenant_id": str(uuid4()),
            "vibration_x": 1.0,
            "vibration_y": 1.0,
            "vibration_z": 1.0,
            "anomaly_score": 0.98,
        }
        result = await evaluate_baseline(payload)
        assert result["guardian_confidence"] == pytest.approx(0.70)


# ---------------------------------------------------------------------------
# TESTS: log_physiomni_alert
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_log_physiomni_alert_success():
    """Alert record should be successfully inserted and returned."""
    db = _make_db_mock()
    client_mock = MagicMock()
    db.client = client_mock

    alert_data = {"id": "alert-uuid-1", "severity": "warning"}
    insert_resp = MagicMock()
    insert_resp.data = [alert_data]
    client_mock.table.return_value.insert.return_value.execute.return_value = insert_resp

    with patch("activities.physiomni_activities.get_database_provider", return_value=db):
        params = {
            "tenant_id": str(uuid4()),
            "device_serial": "DEV-1",
            "message": "Vibration warning limit exceeded",
        }
        result = await log_physiomni_alert(params)
        assert result["id"] == "alert-uuid-1"


# ---------------------------------------------------------------------------
# TESTS: man_mode_escalation_activity
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_man_mode_escalation_activity_success():
    """Structured safety override task should be inserted in public.man_tasks."""
    db = _make_db_mock()
    client_mock = MagicMock()
    db.client = client_mock

    task_data = {"id": "task-uuid-99"}
    insert_resp = MagicMock()
    insert_resp.data = [task_data]
    client_mock.table.return_value.insert.return_value.execute.return_value = insert_resp

    mock_act_info = MagicMock()
    mock_act_info.workflow_id = "wf-test-uuid-99"

    with patch("activities.physiomni_activities.get_database_provider", return_value=db):
        with patch("temporalio.activity.info", return_value=mock_act_info):
            params = {
                "tenant_id": str(uuid4()),
                "device_serial": "DEV-ESCALATE-99",
            }
            result = await man_mode_escalation_activity(params)
            assert result["task_id"] == "task-uuid-99"
            assert result["status"] == "PENDING"


# ---------------------------------------------------------------------------
# TESTS: dispatch_work_order_activity
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_dispatch_work_order_activity_success():
    """Actuation dispatch log should be created in audit_logs."""
    db = _make_db_mock()
    client_mock = MagicMock()
    db.client = client_mock

    audit_data = {"id": "audit-log-uuid-10"}
    insert_resp = MagicMock()
    insert_resp.data = [audit_data]
    client_mock.table.return_value.insert.return_value.execute.return_value = insert_resp

    with patch("activities.physiomni_activities.get_database_provider", return_value=db):
        with patch.dict(
            os.environ,
            {"PHYSIOMNI_PHYSICAL_ACTIONS_ENABLED": "true", "PHYSIOMNI_KILL_SWITCH_ACTIVE": "false"},
        ):
            params = {
                "tenant_id": str(uuid4()),
                "device_serial": "DEV-ACTUATE-10",
            }
            result = await dispatch_work_order_activity(params)
            assert result["status"] == "dispatched"
            assert result["audit_id"] == "audit-log-uuid-10"


@pytest.mark.asyncio
async def test_dispatch_work_order_kill_switch():
    """Actuation should be aborted if kill switch is active."""
    with patch.dict(os.environ, {"PHYSIOMNI_KILL_SWITCH_ACTIVE": "true"}):
        params = {
            "tenant_id": str(uuid4()),
            "device_serial": "DEV-ACTUATE-10",
        }
        result = await dispatch_work_order_activity(params)
        assert result["status"] == "aborted"
        assert result["audit_id"] is None


@pytest.mark.asyncio
async def test_dispatch_work_order_actions_disabled():
    """Actuation should be no-op if physical actions are disabled."""
    with patch.dict(
        os.environ,
        {"PHYSIOMNI_PHYSICAL_ACTIONS_ENABLED": "false", "PHYSIOMNI_KILL_SWITCH_ACTIVE": "false"},
    ):
        params = {
            "tenant_id": str(uuid4()),
            "device_serial": "DEV-ACTUATE-10",
        }
        result = await dispatch_work_order_activity(params)
        assert result["status"] == "no-op"
        assert result["audit_id"] is None

from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

from fastapi.testclient import TestClient

from src.backend.database import get_connection
from src.backend.main import app


INCIDENT = {
    "id": 7,
    "latitude": -20.73,
    "longitude": 116.85,
    "detected_at": datetime(2026, 9, 30, 2, 20, tzinfo=timezone.utc),
    "emission_rate_kg_hr": Decimal("5220.00"),
    "confidence": Decimal("0.9800"),
    "sector": "oil_and_gas",
    "source_type": "lng_facility",
    "severity": "critical",
    "status": "detected",
    "satellite_source": "demo",
    "location_uncertainty_m": Decimal("190.00"),
    "is_real": False,
    "emission_rate_uncertainty_kg_hr": None,
    "operator": "Austral LNG Partners",
    "facility_name": "LNG train 2",
    "data_source": None,
    "external_id": None,
}

EVENT = {
    "id": 1,
    "incident_id": 7,
    "occurred_at": datetime(2026, 9, 30, 2, 20, tzinfo=timezone.utc),
    "actor": "demo",
    "action": "detected",
    "from_value": None,
    "to_value": "detected",
    "note": None,
}


class FakeMappings:
    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self.rows = rows

    def all(self) -> list[dict[str, Any]]:
        return self.rows

    def first(self) -> dict[str, Any] | None:
        return self.rows[0] if self.rows else None


class FakeResult:
    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self.rows = rows

    def mappings(self) -> FakeMappings:
        return FakeMappings(self.rows)


class FakeConnection:
    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self.rows = rows
        self.parameters: dict[str, Any] = {}
        self.query = ""
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.commits = 0

    async def execute(self, query: Any, parameters: dict[str, Any]) -> FakeResult:
        self.query = str(query)
        self.parameters = parameters
        self.calls.append((self.query, parameters))
        return FakeResult(self.rows)

    async def commit(self) -> None:
        self.commits += 1


def client_with_rows(rows: list[dict[str, Any]]) -> tuple[TestClient, FakeConnection]:
    connection = FakeConnection(rows)

    async def override_connection():
        yield connection

    app.dependency_overrides[get_connection] = override_connection
    return TestClient(app), connection


def test_list_incidents_returns_rows_and_applies_filters() -> None:
    client, connection = client_with_rows([INCIDENT])

    try:
        response = client.get(
            "/incidents",
            params={
                "status": "detected",
                "severity": "critical",
                "sector": "oil_and_gas",
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json()[0]["id"] == 7
    assert response.json()[0]["emission_rate_kg_hr"] == 5220.0
    assert connection.parameters == {
        "status": "detected",
        "severity": "critical",
        "sector": "oil_and_gas",
    }


def test_get_incident_returns_one_row() -> None:
    client, connection = client_with_rows([INCIDENT])

    try:
        response = client.get("/incidents/7")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json()["source_type"] == "lng_facility"
    assert connection.parameters == {"incident_id": 7}


def test_get_incident_returns_404_when_missing() -> None:
    client, _ = client_with_rows([])

    try:
        response = client.get("/incidents/9999")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 404
    assert response.json() == {"detail": "Incident not found"}


def test_list_incidents_rejects_unknown_status() -> None:
    client, _ = client_with_rows([])

    try:
        response = client.get("/incidents", params={"status": "unknown"})
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 422


def test_patch_incident_updates_only_provided_fields() -> None:
    updated_incident = {**INCIDENT, "status": "investigating"}
    client, connection = client_with_rows([updated_incident])

    try:
        response = client.patch("/incidents/7", json={"status": "investigating"})
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json()["status"] == "investigating"
    assert connection.parameters == {
        "incident_id": 7,
        "status": "investigating",
    }
    assert "status = :status" in connection.query
    assert "severity = :severity" not in connection.query
    assert connection.commits == 1


def test_list_incidents_returns_attribution_fields() -> None:
    client, _ = client_with_rows([INCIDENT])

    try:
        response = client.get("/incidents")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json()[0]["operator"] == "Austral LNG Partners"
    assert response.json()[0]["facility_name"] == "LNG train 2"


def test_unattributed_public_detection_has_no_confidence() -> None:
    public = {**INCIDENT, "confidence": None, "operator": None, "facility_name": None, "is_real": True,
              "sector": "unattributed", "source_type": "unattributed", "data_source": "SRON weekly methane plumes"}
    client, _ = client_with_rows([public])

    try:
        response = client.get("/incidents")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json()[0]["confidence"] is None
    assert response.json()[0]["data_source"] == "SRON weekly methane plumes"


def test_patch_passes_actor_and_note_to_the_audit_trigger() -> None:
    client, connection = client_with_rows([{**INCIDENT, "status": "investigating"}])

    try:
        response = client.patch(
            "/incidents/7",
            json={"status": "investigating", "actor": "Field inspectorate", "note": "Crew on site"},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    first_query, first_parameters = connection.calls[0]
    assert "set_config('app.actor'" in first_query
    assert first_parameters == {"actor": "Field inspectorate", "note": "Crew on site"}
    assert "UPDATE methane_incidents" in connection.calls[-1][0]
    assert connection.commits == 1


def test_patch_without_actor_names_the_api() -> None:
    client, connection = client_with_rows([INCIDENT])

    try:
        client.patch("/incidents/7", json={"severity": "high"})
    finally:
        app.dependency_overrides.clear()

    assert connection.calls[0][1] == {"actor": "api", "note": ""}


def test_patch_with_only_a_note_records_a_note_event() -> None:
    client, connection = client_with_rows([INCIDENT])

    try:
        response = client.patch("/incidents/7", json={"note": "Operator report received", "actor": "Operator"})
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    insert_query, insert_parameters = connection.calls[-1]
    assert "INSERT INTO incident_events" in insert_query
    assert insert_parameters == {"incident_id": 7, "actor": "Operator", "note": "Operator report received"}
    assert connection.commits == 1


def test_patch_with_nothing_to_change_does_not_commit() -> None:
    client, connection = client_with_rows([INCIDENT])

    try:
        response = client.patch("/incidents/7", json={})
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert connection.commits == 0


def test_patch_rejects_an_empty_actor() -> None:
    client, _ = client_with_rows([INCIDENT])

    try:
        response = client.patch("/incidents/7", json={"status": "investigating", "actor": ""})
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 422


def test_list_incident_events_returns_the_trail() -> None:
    client, connection = client_with_rows([EVENT])

    try:
        response = client.get("/incidents/7/events")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json()[0]["action"] == "detected"
    assert "ORDER BY occurred_at, id" in connection.query
    assert connection.parameters == {"incident_id": 7}


def test_list_incident_events_returns_404_when_missing() -> None:
    client, _ = client_with_rows([])

    try:
        response = client.get("/incidents/9999/events")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 404


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
        self.commits = 0

    async def execute(self, query: Any, parameters: dict[str, Any]) -> FakeResult:
        self.query = str(query)
        self.parameters = parameters
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


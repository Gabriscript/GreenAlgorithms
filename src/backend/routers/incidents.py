from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

from src.backend.database import get_connection
from src.backend.schemas import (
    IncidentEventResponse,
    IncidentResponse,
    IncidentSeverity,
    IncidentStatus,
    IncidentUpdate,
)


router = APIRouter(prefix="/incidents", tags=["incidents"])

INCIDENT_COLUMNS = """
    id,
    latitude,
    longitude,
    detected_at,
    emission_rate_kg_hr,
    emission_rate_uncertainty_kg_hr,
    confidence,
    sector,
    source_type,
    severity,
    status,
    satellite_source,
    location_uncertainty_m,
    is_real,
    operator,
    facility_name,
    data_source,
    external_id
"""

EVENT_COLUMNS = "id, incident_id, occurred_at, actor, action, from_value, to_value, note"

# who the audit trail names when a client does not say
DEFAULT_ACTOR = "api"


def incident_not_found() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="Incident not found",
    )


@router.get("", response_model=list[IncidentResponse])
async def list_incidents(
    connection: Annotated[AsyncConnection, Depends(get_connection)],
    incident_status: Annotated[IncidentStatus | None, Query(alias="status")] = None,
    severity: Annotated[IncidentSeverity | None, Query()] = None,
    sector: Annotated[str | None, Query(min_length=1)] = None,
) -> list[dict[str, Any]]:
    filters: list[str] = []
    parameters: dict[str, str] = {}

    if incident_status is not None:
        filters.append("status = :status")
        parameters["status"] = incident_status.value
    if severity is not None:
        filters.append("severity = :severity")
        parameters["severity"] = severity.value
    if sector is not None:
        filters.append("sector = :sector")
        parameters["sector"] = sector

    query = f"SELECT {INCIDENT_COLUMNS} FROM methane_incidents"
    if filters:
        query += " WHERE " + " AND ".join(filters)
    query += " ORDER BY detected_at DESC, id DESC"

    result = await connection.execute(text(query), parameters)
    return [dict(row) for row in result.mappings().all()]


@router.get("/{incident_id}", response_model=IncidentResponse)
async def get_incident(
    connection: Annotated[AsyncConnection, Depends(get_connection)],
    incident_id: Annotated[int, Path(gt=0)],
) -> dict[str, Any]:
    query = text(
        f"""
        SELECT {INCIDENT_COLUMNS}
        FROM methane_incidents
        WHERE id = :incident_id
        """
    )
    result = await connection.execute(query, {"incident_id": incident_id})
    incident = result.mappings().first()

    if incident is None:
        raise incident_not_found()

    return dict(incident)


@router.get("/{incident_id}/events", response_model=list[IncidentEventResponse])
async def list_incident_events(
    connection: Annotated[AsyncConnection, Depends(get_connection)],
    incident_id: Annotated[int, Path(gt=0)],
) -> list[dict[str, Any]]:
    exists = await connection.execute(
        text("SELECT id FROM methane_incidents WHERE id = :incident_id"),
        {"incident_id": incident_id},
    )
    if exists.mappings().first() is None:
        raise incident_not_found()

    result = await connection.execute(
        text(
            f"""
            SELECT {EVENT_COLUMNS}
            FROM incident_events
            WHERE incident_id = :incident_id
            ORDER BY occurred_at, id
            """
        ),
        {"incident_id": incident_id},
    )
    return [dict(row) for row in result.mappings().all()]


@router.patch("/{incident_id}", response_model=IncidentResponse)
async def update_incident(
    update: IncidentUpdate,
    connection: Annotated[AsyncConnection, Depends(get_connection)],
    incident_id: Annotated[int, Path(gt=0)],
) -> dict[str, Any]:
    updates = update.model_dump(exclude_unset=True, mode="json", include={"status", "severity"})

    # The database's audit trigger records every status or severity change. It reads who made the change and why
    # from these settings, which last for this transaction only.
    await connection.execute(
        text("SELECT set_config('app.actor', :actor, true), set_config('app.note', :note, true)"),
        {"actor": update.actor or DEFAULT_ACTOR, "note": update.note or ""},
    )

    if updates:
        assignments = ", ".join(f"{field} = :{field}" for field in updates)
        query = text(
            f"""
            UPDATE methane_incidents
            SET {assignments}
            WHERE id = :incident_id
            RETURNING {INCIDENT_COLUMNS}
            """
        )
    else:
        query = text(
            f"""
            SELECT {INCIDENT_COLUMNS}
            FROM methane_incidents
            WHERE id = :incident_id
            """
        )

    parameters = {"incident_id": incident_id, **updates}
    result = await connection.execute(query, parameters)
    incident = result.mappings().first()

    if incident is None:
        raise incident_not_found()

    if not updates and update.note:
        # a note without a change is still evidence (an operator's report, a site visit): it goes on record by itself
        await connection.execute(
            text(
                """
                INSERT INTO incident_events (incident_id, actor, action, note)
                VALUES (:incident_id, :actor, 'note', :note)
                """
            ),
            {"incident_id": incident_id, "actor": update.actor or DEFAULT_ACTOR, "note": update.note},
        )

    if updates or update.note:
        await connection.commit()

    return dict(incident)

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

from src.backend.database import get_connection
from src.backend.schemas import (
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
    confidence,
    sector,
    source_type,
    severity,
    status,
    satellite_source,
    location_uncertainty_m,
    is_real
"""


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
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Incident not found",
        )

    return dict(incident)


@router.patch("/{incident_id}", response_model=IncidentResponse)
async def update_incident(
    update: IncidentUpdate,
    connection: Annotated[AsyncConnection, Depends(get_connection)],
    incident_id: Annotated[int, Path(gt=0)],
) -> dict[str, Any]:
    updates = update.model_dump(exclude_unset=True, mode="json")

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
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Incident not found",
        )

    if updates:
        await connection.commit()

    return dict(incident)


from datetime import datetime
from enum import Enum

from pydantic import BaseModel, ConfigDict, Field, field_validator


class IncidentSeverity(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class IncidentStatus(str, Enum):
    DETECTED = "detected"
    AWAITING_REVIEW = "awaiting_review"
    INVESTIGATING = "investigating"
    ACTION_ASSIGNED = "action_assigned"
    REPAIR_IN_PROGRESS = "repair_in_progress"
    AWAITING_VERIFICATION = "awaiting_verification"
    RESOLVED = "resolved"


class IncidentUpdate(BaseModel):
    status: IncidentStatus | None = None
    severity: IncidentSeverity | None = None
    # recorded in the audit trail with each change; without authentication the actor is self-reported
    actor: str | None = Field(default=None, min_length=1, max_length=100)
    note: str | None = Field(default=None, min_length=1, max_length=1000)

    @field_validator("status", "severity")
    @classmethod
    def reject_null_updates(cls, value: IncidentStatus | IncidentSeverity | None):
        if value is None:
            raise ValueError("Update fields cannot be null")
        return value


class IncidentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    latitude: float
    longitude: float
    detected_at: datetime
    emission_rate_kg_hr: float
    emission_rate_uncertainty_kg_hr: float | None = None
    confidence: float | None
    sector: str
    source_type: str
    severity: IncidentSeverity
    status: IncidentStatus
    satellite_source: str
    location_uncertainty_m: float
    is_real: bool
    operator: str | None = None
    facility_name: str | None = None
    data_source: str | None = None
    external_id: str | None = None


class IncidentEventAction(str, Enum):
    DETECTED = "detected"
    STATUS_CHANGED = "status_changed"
    SEVERITY_CHANGED = "severity_changed"
    NOTE = "note"


class IncidentEventResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    incident_id: int
    occurred_at: datetime
    actor: str
    action: IncidentEventAction
    from_value: str | None
    to_value: str | None
    note: str | None

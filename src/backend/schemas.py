from datetime import datetime
from enum import Enum

from pydantic import BaseModel, ConfigDict, field_validator


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
    confidence: float
    sector: str
    source_type: str
    severity: IncidentSeverity
    status: IncidentStatus
    satellite_source: str
    location_uncertainty_m: float
    is_real: bool


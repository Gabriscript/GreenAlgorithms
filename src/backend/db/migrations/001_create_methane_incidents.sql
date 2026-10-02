BEGIN;

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE methane_incidents (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    latitude DOUBLE PRECISION NOT NULL
        CHECK (latitude BETWEEN -90 AND 90),
    longitude DOUBLE PRECISION NOT NULL
        CHECK (longitude BETWEEN -180 AND 180),
    location GEOGRAPHY(POINT, 4326)
        GENERATED ALWAYS AS (
            ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::GEOGRAPHY
        ) STORED,
    detected_at TIMESTAMPTZ NOT NULL,
    emission_rate_kg_hr NUMERIC(12, 2) NOT NULL
        CHECK (emission_rate_kg_hr > 0),
    confidence NUMERIC(5, 4) NOT NULL
        CHECK (confidence BETWEEN 0 AND 1),
    sector TEXT NOT NULL
        CHECK (BTRIM(sector) <> ''),
    source_type TEXT NOT NULL
        CHECK (BTRIM(source_type) <> ''),
    severity TEXT NOT NULL
        CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    status TEXT NOT NULL DEFAULT 'detected'
        CHECK (status IN (
            'detected',
            'awaiting_review',
            'investigating',
            'action_assigned',
            'repair_in_progress',
            'awaiting_verification',
            'resolved'
        )),
    satellite_source TEXT NOT NULL
        CHECK (BTRIM(satellite_source) <> ''),
    location_uncertainty_m NUMERIC(10, 2) NOT NULL
        CHECK (location_uncertainty_m >= 0),
    is_real BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (updated_at >= created_at)
);

CREATE INDEX methane_incidents_location_gix
    ON methane_incidents USING GIST (location);

CREATE INDEX methane_incidents_detected_at_idx
    ON methane_incidents (detected_at DESC);

CREATE INDEX methane_incidents_status_severity_idx
    ON methane_incidents (status, severity);

CREATE OR REPLACE FUNCTION set_methane_incidents_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;

CREATE TRIGGER methane_incidents_set_updated_at
BEFORE UPDATE ON methane_incidents
FOR EACH ROW
EXECUTE FUNCTION set_methane_incidents_updated_at();

COMMIT;


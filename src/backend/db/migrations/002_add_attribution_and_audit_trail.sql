-- Attribution (who operates the source), provenance (where a detection came from) and an append-only audit trail.
BEGIN;

ALTER TABLE methane_incidents
    ADD COLUMN operator TEXT
        CHECK (operator IS NULL OR BTRIM(operator) <> ''),
    ADD COLUMN facility_name TEXT
        CHECK (facility_name IS NULL OR BTRIM(facility_name) <> ''),
    ADD COLUMN emission_rate_uncertainty_kg_hr NUMERIC(12, 2)
        CHECK (emission_rate_uncertainty_kg_hr >= 0),
    ADD COLUMN data_source TEXT
        CHECK (data_source IS NULL OR BTRIM(data_source) <> ''),
    ADD COLUMN external_id TEXT UNIQUE
        CHECK (external_id IS NULL OR BTRIM(external_id) <> ''),
    -- a public satellite detection arrives unattributed, so it has no attribution confidence
    ALTER COLUMN confidence DROP NOT NULL;

CREATE INDEX methane_incidents_operator_idx
    ON methane_incidents (operator);

CREATE TABLE incident_events (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    incident_id BIGINT NOT NULL
        REFERENCES methane_incidents (id) ON DELETE CASCADE,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actor TEXT NOT NULL
        CHECK (BTRIM(actor) <> ''),
    action TEXT NOT NULL
        CHECK (action IN ('detected', 'status_changed', 'severity_changed', 'note')),
    from_value TEXT,
    to_value TEXT,
    note TEXT
);

CREATE INDEX incident_events_incident_idx
    ON incident_events (incident_id, occurred_at, id);

-- events are a record: rows can be added, never edited (deleting an incident still removes its events)
CREATE OR REPLACE FUNCTION reject_incident_event_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'incident_events is append-only';
END;
$$;

CREATE TRIGGER incident_events_append_only
BEFORE UPDATE ON incident_events
FOR EACH ROW
EXECUTE FUNCTION reject_incident_event_update();

-- The database logs every new incident and every status or severity change itself, whichever client makes it.
-- A client names itself with set_config('app.actor', ..., true) and can add set_config('app.note', ..., true);
-- without them the database user is recorded.
CREATE OR REPLACE FUNCTION log_methane_incident_event()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    who TEXT := COALESCE(NULLIF(current_setting('app.actor', true), ''), current_user);
    why TEXT := NULLIF(current_setting('app.note', true), '');
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO incident_events (incident_id, occurred_at, actor, action, to_value, note)
        VALUES (NEW.id, NEW.detected_at, NEW.satellite_source, 'detected', NEW.status, why);
        RETURN NEW;
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status THEN
        INSERT INTO incident_events (incident_id, actor, action, from_value, to_value, note)
        VALUES (NEW.id, who, 'status_changed', OLD.status, NEW.status, why);
    END IF;
    IF NEW.severity IS DISTINCT FROM OLD.severity THEN
        INSERT INTO incident_events (incident_id, actor, action, from_value, to_value, note)
        VALUES (NEW.id, who, 'severity_changed', OLD.severity, NEW.severity, why);
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER methane_incidents_log_insert
AFTER INSERT ON methane_incidents
FOR EACH ROW
EXECUTE FUNCTION log_methane_incident_event();

CREATE TRIGGER methane_incidents_log_change
AFTER UPDATE OF status, severity ON methane_incidents
FOR EACH ROW
EXECUTE FUNCTION log_methane_incident_event();

-- incidents that already exist get their detection on record too
INSERT INTO incident_events (incident_id, occurred_at, actor, action, to_value, note)
SELECT id, detected_at, satellite_source, 'detected', status, 'Recorded when the audit trail was added'
FROM methane_incidents;

COMMIT;

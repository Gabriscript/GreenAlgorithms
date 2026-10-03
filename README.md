# MIRA: Methane Incident Response & Action

This repository contains a PostgreSQL/PostGIS database of methane incidents, a
FastAPI service over it, and the MIRA front end (`src/frontend`, see its
README). The database holds synthetic demo incidents plus a small sample of real
satellite detections, and keeps an append-only audit trail of every change.
There is no authentication, satellite ingestion or AI yet.

## Quick start

**Fastest, nothing to install:** open `src/frontend/index.html` in a browser. It shows a saved copy of the database, so you can try every screen, including **Play demo tour**.

**Full version, with the live database and API** (about five minutes). You need:

- [Docker Desktop](https://www.docker.com/products/docker-desktop/), running, for the database
- [Python](https://www.python.org/downloads/) 3.11 or newer, for the API and to serve the page

Run these from the repository root, each step in its own terminal where it says so:

```powershell
# 1. Database (PostgreSQL + PostGIS). The first start loads the tables and demo data by itself.
docker compose up -d

# 2. API: install once, then run (keep this terminal open)
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn src.backend.main:app --reload

# 3. Web page (second terminal, keep it open)
python -m http.server 5173 --directory src/frontend
```

Then open **http://localhost:5173**. On macOS or Linux, activate the environment with `source .venv/bin/activate` instead.

Use port **5173**: the API only accepts pages from `localhost:5173` and `localhost:3000` (`CORS_ORIGINS`). Any other port is blocked by the browser, and the page quietly falls back to the saved copy.

You can tell it is live when there is no message saying "Could not reach the incident API". The API's own page, with every route, is at http://127.0.0.1:8000/docs.

With the live database, **Assign ticket** and **Log fix as applied** are saved (`PATCH /incidents/{id}`) and appear in each incident's audit trail at `/incidents/{id}/events`. The demo tour never writes, and the page without the API (the saved copy) never writes either.

No `.env` file is needed: the defaults in `compose.yaml` and in the API match. To change the password or port, copy `.env.example` to `.env`.

If something looks wrong, `docker compose down -v` followed by `docker compose up -d` rebuilds the database from scratch (it deletes the data in it, which is only the demo data).

## Database layout

- `src/backend/db/migrations/001_create_methane_incidents.sql` enables PostGIS,
  creates `methane_incidents`, and adds spatial and query indexes.
- `src/backend/db/migrations/002_add_attribution_and_audit_trail.sql` adds
  attribution (`operator`, `facility_name`), provenance (`data_source`,
  `external_id`, `emission_rate_uncertainty_kg_hr`), makes `confidence`
  optional for unattributed detections, and creates the `incident_events` audit
  trail with the triggers that fill it.
- `src/backend/db/seeds/001_seed_methane_incidents.sql` inserts 30 synthetic
  incidents across Europe, Australia, and the Pacific. Their operators and
  facilities are fictional.
- `src/backend/db/seeds/002_seed_public_detections.sql` inserts four real
  detections from SRON's public Sentinel-5P plume data (see "Data sources").
- `compose.yaml` starts PostgreSQL 16 with PostGIS and runs the two migrations
  and the two seeds, in that order, when the database volume is first created.

The `location` geography point is generated from `longitude` and `latitude`, so
applications only supply the coordinate fields and cannot create inconsistent
spatial data.

## Configure the database

Copy `.env.example` to `.env` and set a development password. The API reads the
individual `POSTGRES_*` settings by default (port 5432, as in `compose.yaml`).
You can instead set `DATABASE_URL` to a full SQLAlchemy async PostgreSQL URL,
for example:

```dotenv
DATABASE_URL=postgresql+asyncpg://methane_app:change-me@localhost:5432/methane_tracker
```

Start PostgreSQL/PostGIS:

```sh
docker compose up -d
```

The initialization scripts run automatically only for a new database volume.
To bring an existing database up to date, run the files with `psql` in this
order: `002_add_attribution_and_audit_trail.sql` (if it has not run yet), then
both seeds. The seeds are repeatable: the demo seed replaces only synthetic
rows whose satellite source is `demo`, and the public seed skips rows it has
already inserted. Re-running the demo seed gives its rows new ids.

## Install and run the API

Create a virtual environment and install the dependencies:

```sh
python -m venv .venv
```

On PowerShell:

```powershell
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

Run FastAPI from the repository root:

```sh
uvicorn src.backend.main:app --reload
```

The API and interactive documentation are available at:

- `http://127.0.0.1:8000/incidents`
- `http://127.0.0.1:8000/docs`

Optional filters can be combined, for example:

```text
GET /incidents?status=investigating&severity=high&sector=oil_and_gas
```

Allowed development frontend origins are configured with the comma-separated
`CORS_ORIGINS` environment variable.

## API routes

- `GET /incidents` returns all incidents, optionally filtered by `status`,
  `severity`, and `sector`.
- `GET /incidents/{id}` returns one incident or HTTP 404.
- `GET /incidents/{id}/events` returns the incident's audit trail, oldest
  first, or HTTP 404.
- `PATCH /incidents/{id}` changes `status` and/or `severity`. Optional `actor`
  (who is making the change) and `note` (why) go into the audit trail; a
  `note` on its own is recorded as a note event. Without `actor`, the change
  is recorded as made by `api`.

CORS allows every method, so the front end can call `PATCH` from an allowed
origin.

## Audit trail

The database records events itself, whichever client makes the change: a
`detected` event when an incident is inserted, and a `status_changed` or
`severity_changed` event, with the old and new values, when either changes. A
client names itself with `set_config('app.actor', ..., true)` and can add
`set_config('app.note', ..., true)` in the same transaction, which is what
`PATCH` does; otherwise the database user is recorded. Events cannot be edited
(an update raises an error); deleting an incident removes its events. There is
no authentication yet, so `actor` is whatever the client says it is.

## Run tests

Install the development dependencies and run the endpoint tests:

```sh
pip install -r requirements-dev.txt
pytest
```

The tests replace the database connection with a fake one, so they do not run
the SQL or the triggers. Those were checked against PostgreSQL 16 with PostGIS
3.4: a new volume, an upgrade of a database built from migration 001 and the
old seed, both seeds run twice, the audit trigger, and the append-only rule.

## Check the seed

```sh
docker compose exec database psql -U methane_app -d methane_tracker \
  -c "SELECT is_real, COUNT(*) FROM methane_incidents GROUP BY is_real;"
```

## Data sources

- Synthetic demo incidents, operators and facilities: invented for this
  prototype (`is_real = false`, satellite source `demo`).
- Real detections (`is_real = true`): SRON weekly methane plume detections from
  TROPOMI on Copernicus Sentinel-5P, https://ftp.sron.nl/pub/memo/CSVs/.
  Product generation by the SRON team (earth.sron.nl/methane-emissions/);
  Schuit et al. (2023), Atmospheric Chemistry and Physics,
  https://doi.org/10.5194/acp-23-9071-2023. Licensed under CC BY 4.0. Contains
  modified Copernicus Sentinel-5P data. Four of the smaller detections from
  2026 weeks 37 to 39 were taken; the seed file lists what was read from the
  data and what was set because the data does not have it (no attribution,
  confidence, or operator).

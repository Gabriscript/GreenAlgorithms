# Methane Incident Tracker

This repository contains a PostgreSQL/PostGIS database, synthetic demo data,
and a minimal read-only FastAPI service. It does not include a frontend,
authentication, ticketing, satellite ingestion, AI features, or mutation
routes.

## Database layout

- `src/backend/db/migrations/001_create_methane_incidents.sql` enables PostGIS,
  creates `methane_incidents`, and adds spatial and query indexes.
- `src/backend/db/seeds/001_seed_methane_incidents.sql` inserts 30 synthetic
  incidents across Europe, Australia, and the Pacific.
- `compose.yaml` starts PostgreSQL 16 with PostGIS and runs both SQL files when
  the database volume is first created.

The `location` geography point is generated from `longitude` and `latitude`, so
applications only supply the coordinate fields and cannot create inconsistent
spatial data.

## Configure the database

Copy `.env.example` to `.env` and set a development password. The API reads the
individual `POSTGRES_*` settings by default. You can instead set `DATABASE_URL`
to a full SQLAlchemy async PostgreSQL URL, for example:

```dotenv
DATABASE_URL=postgresql+asyncpg://methane_app:change-me@localhost:5432/methane_tracker
```

Start PostgreSQL/PostGIS:

```sh
docker compose up -d
```

The initialization scripts run automatically only for a new database volume.
To apply them to an existing database, execute the migration and seed files with
`psql` in that order. The seed is repeatable: it replaces only synthetic rows
whose satellite source is `demo`.

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

## Run tests

Install the development dependencies and run the endpoint tests:

```sh
pip install -r requirements-dev.txt
pytest
```

## Check the seed

```sh
docker compose exec database psql -U methane_app -d methane_tracker \
  -c "SELECT COUNT(*) FROM methane_incidents;"
```


BEGIN;

-- Real satellite detections: a small public sample next to the synthetic demo seed.
--
-- Source: SRON weekly methane plume detections, TROPOMI on Copernicus Sentinel-5P (https://ftp.sron.nl/pub/memo/CSVs/).
-- Product generation by the SRON team (earth.sron.nl/methane-emissions/). Schuit et al. (2023), Atmospheric Chemistry
-- and Physics, https://doi.org/10.5194/acp-23-9071-2023. Licensed under CC BY 4.0
-- (https://creativecommons.org/licenses/by/4.0/). Contains modified Copernicus Sentinel-5P data. Changes: units, the
-- fields below.
--
-- Four of the smaller detections from 2026 weeks 37 to 39, picked so they sit on the same scale as the demo data:
-- TROPOMI only sees large plumes, and many detections in these weeks are 50 to 350 t/h.
-- Read from the CSV: date and time (UTC), latitude, longitude, source_rate_t/h and uncertainty_t/h (both x 1000 to kg/h).
-- Not in the data, so set here: no attribution (sector and source type 'unattributed', confidence and operator NULL),
-- location uncertainty 7000 m (one TROPOMI pixel is about 5.5 x 7 km), severity 'critical' (all are above 2 t/h,
-- the demo seed's critical range) and status 'detected'.
-- Repeatable: each row has an external_id, so running this again changes nothing.
INSERT INTO methane_incidents (
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
    data_source,
    external_id
)
VALUES
    (32.3700, -101.6800, '2026-09-20T20:34:17Z', 11000.00, 4000.00, NULL, 'unattributed', 'unattributed', 'critical', 'detected', 'Sentinel-5P', 7000.00, TRUE, 'SRON weekly methane plumes, 2026 week 39 (CC BY 4.0)', 'SRON-2026-wk39-13'), -- United States (Permian Basin, Texas)
    (29.5300,   29.0500, '2026-09-22T11:28:11Z', 11000.00, 4000.00, NULL, 'unattributed', 'unattributed', 'critical', 'detected', 'Sentinel-5P', 7000.00, TRUE, 'SRON weekly methane plumes, 2026 week 39 (CC BY 4.0)', 'SRON-2026-wk39-27'), -- Egypt
    (39.3000,   65.4400, '2026-09-19T09:04:54Z',  7000.00, 3000.00, NULL, 'unattributed', 'unattributed', 'critical', 'detected', 'Sentinel-5P', 7000.00, TRUE, 'SRON weekly methane plumes, 2026 week 39 (CC BY 4.0)', 'SRON-2026-wk39-4'),  -- Uzbekistan
    (28.1800,    9.3600, '2026-09-08T12:31:18Z',  6000.00, 3000.00, NULL, 'unattributed', 'unattributed', 'critical', 'detected', 'Sentinel-5P', 7000.00, TRUE, 'SRON weekly methane plumes, 2026 week 37 (CC BY 4.0)', 'SRON-2026-wk37-33')  -- Algeria
ON CONFLICT (external_id) DO NOTHING;

COMMIT;

BEGIN;

-- Keep this demo seed repeatable without affecting real or non-demo records.
-- Every operator and facility below is fictional, invented for the demo; none is a real company or site.
DELETE FROM methane_incidents
WHERE satellite_source = 'demo'
  AND is_real = FALSE;

INSERT INTO methane_incidents (
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
    is_real,
    operator,
    facility_name
)
VALUES
    -- Europe
    (53.2194,   6.5665, '2026-09-28T08:15:00Z',  420.00, 0.9100, 'oil_and_gas',     'gas_field',             'medium',   'investigating',          'demo',  180.00, FALSE, 'Northgate Energy',             'Gas production cluster 7'),     -- Groningen, Netherlands
    (57.0500,   1.5000, '2026-09-25T19:40:00Z', 3850.00, 0.9600, 'oil_and_gas',     'offshore_platform',      'critical', 'repair_in_progress',     'demo',  260.00, FALSE, 'Northgate Energy',             'Platform B-12'),                -- North Sea, United Kingdom
    (50.2649,  19.0238, '2026-09-21T10:05:00Z', 1760.00, 0.8800, 'coal_mining',     'underground_coal_mine',  'high',     'action_assigned',        'demo',  340.00, FALSE, 'Carbonvale Mining',            'Ventilation shaft 3'),          -- Silesia, Poland
    (51.4556,   7.0116, '2026-09-16T14:25:00Z',  195.00, 0.7300, 'waste_management','landfill',               'low',      'awaiting_review',        'demo',  520.00, FALSE, 'Greybridge Waste Services',    'Landfill cell 4'),              -- Ruhr, Germany
    (45.2400,   9.1000, '2026-09-10T06:50:00Z',  310.00, 0.7900, 'agriculture',      'dairy_farm',             'medium',   'detected',               'demo',  650.00, FALSE, 'Riverplain Dairy Cooperative', 'Dairy unit 21'),                -- Lombardy, Italy
    (44.9417,  26.0237, '2026-09-03T12:30:00Z', 1120.00, 0.9300, 'oil_and_gas',     'refinery',               'high',     'awaiting_verification',  'demo',  210.00, FALSE, 'Northgate Energy',             'Refinery unit 2'),              -- Ploiesti, Romania
    (70.6634,  23.6821, '2026-08-27T22:10:00Z', 2480.00, 0.9700, 'oil_and_gas',     'lng_facility',           'critical', 'resolved',               'demo',  150.00, FALSE, 'Northgate Energy',             'LNG train 1'),                  -- Hammerfest, Norway
    (37.2614,  -6.9447, '2026-08-19T09:00:00Z',  155.00, 0.6800, 'waste_management','landfill',               'low',      'investigating',          'demo',  780.00, FALSE, 'Greybridge Waste Services',    'Landfill north cell'),          -- Huelva, Spain
    (43.4137,  -0.6184, '2026-08-11T16:45:00Z',  735.00, 0.8500, 'oil_and_gas',     'gas_processing_plant',   'medium',   'action_assigned',        'demo',  290.00, FALSE, 'Northgate Energy',             'Gas processing plant 1'),       -- Lacq, France
    (40.7730,  24.7030, '2026-07-31T04:20:00Z', 1650.00, 0.9000, 'oil_and_gas',     'offshore_platform',      'high',     'repair_in_progress',     'demo',  410.00, FALSE, 'Aegean Offshore Partners',     'Platform A'),                   -- Prinos, Greece
    (51.6600,  -3.8500, '2026-07-18T11:35:00Z',  890.00, 0.8200, 'coal_mining',     'abandoned_coal_mine',    'medium',   'awaiting_review',        'demo',  940.00, FALSE, 'Valleys Mine Remediation',     'Abandoned mine adit 2'),        -- South Wales, United Kingdom
    (52.4100,  12.5500, '2026-06-29T18:55:00Z',  120.00, 0.6100, 'agriculture',      'livestock_operation',    'low',      'resolved',               'demo', 1150.00, FALSE, 'Havel Livestock',              'Livestock unit 5'),             -- Brandenburg, Germany

    -- Australia
    (-20.7300, 116.8500, '2026-09-30T02:20:00Z', 5220.00, 0.9800, 'oil_and_gas',     'lng_facility',           'critical', 'detected',               'demo',  190.00, FALSE, 'Austral LNG Partners',         'LNG train 2'),                  -- Karratha, Western Australia
    (-23.5200, 148.1600, '2026-09-26T07:45:00Z', 2140.00, 0.9400, 'coal_mining',     'open_cut_coal_mine',     'high',     'investigating',          'demo',  280.00, FALSE, 'Brigalow Coal',                'Open-cut pit 4'),               -- Bowen Basin, Queensland
    (-27.1800, 149.0700, '2026-09-20T21:15:00Z', 1380.00, 0.8900, 'oil_and_gas',     'coal_seam_gas_field',    'high',     'action_assigned',        'demo',  330.00, FALSE, 'Austral LNG Partners',         'Gas gathering station 9'),      -- Surat Basin, Queensland
    (-32.4100, 151.0200, '2026-09-14T03:30:00Z',  960.00, 0.8600, 'coal_mining',     'underground_coal_mine',  'medium',   'awaiting_verification',  'demo',  390.00, FALSE, 'Brigalow Coal',                'Ventilation shaft 1'),          -- Hunter Valley, New South Wales
    (-38.3100, 148.2100, '2026-09-07T13:05:00Z', 3450.00, 0.9500, 'oil_and_gas',     'offshore_platform',      'critical', 'repair_in_progress',     'demo',  240.00, FALSE, 'Austral LNG Partners',         'Platform C'),                   -- Bass Strait, Victoria
    (-12.4700, 130.9500, '2026-08-30T05:40:00Z',  275.00, 0.7600, 'waste_management','landfill',               'medium',   'awaiting_review',        'demo',  620.00, FALSE, 'Top End Waste',                'Landfill east cell'),           -- Darwin, Northern Territory
    (-31.9505, 115.8605, '2026-08-22T17:25:00Z',  145.00, 0.7000, 'waste_management','wastewater_plant',       'low',      'resolved',               'demo',  480.00, FALSE, 'Coastal Water Utilities',      'Wastewater plant 2'),           -- Perth, Western Australia
    (-37.4500, 144.1000, '2026-08-13T00:10:00Z',  385.00, 0.8100, 'agriculture',      'dairy_farm',             'medium',   'detected',               'demo',  870.00, FALSE, 'Goldfields Dairy',             'Dairy unit 8'),                 -- Central Victoria
    (-30.1000, 150.9000, '2026-08-02T08:35:00Z',  245.00, 0.7400, 'agriculture',      'feedlot',                'low',      'investigating',          'demo', 1050.00, FALSE, 'Tablelands Feedlots',          'Feedlot 3'),                    -- New England, New South Wales
    (-21.8900, 119.7300, '2026-07-23T20:50:00Z', 1890.00, 0.9200, 'mining',           'iron_ore_mine',          'high',     'action_assigned',        'demo',  360.00, FALSE, 'Redrock Iron',                 'Ore processing hub'),           -- Pilbara, Western Australia
    (-34.9300, 138.6000, '2026-07-09T10:30:00Z',   95.00, 0.6500, 'waste_management','wastewater_plant',       'low',      'awaiting_verification',  'demo',  570.00, FALSE, 'Coastal Water Utilities',      'Wastewater plant 5'),           -- Adelaide, South Australia
    (-42.0800, 147.0600, '2026-06-21T01:55:00Z',  205.00, 0.7200, 'agriculture',      'livestock_operation',    'low',      'resolved',               'demo', 1240.00, FALSE, 'Midlands Grazing',             'Livestock unit 2'),             -- Tasmanian Midlands

    -- Pacific region
    (-6.1300,  142.8400, '2026-09-23T23:35:00Z', 6120.00, 0.9700, 'oil_and_gas',     'gas_processing_plant',   'critical', 'investigating',          'demo',  310.00, FALSE, 'Highlands Gas Venture',        'Gas conditioning plant'),       -- Hides, Papua New Guinea
    (-39.0600, 174.0800, '2026-09-12T15:20:00Z',  680.00, 0.8400, 'oil_and_gas',     'onshore_gas_field',      'medium',   'repair_in_progress',     'demo',  420.00, FALSE, 'Ring Plain Energy',            'Wellsite 14'),                  -- Taranaki, New Zealand
    (-37.7800, 175.2800, '2026-08-25T03:45:00Z',  335.00, 0.7800, 'agriculture',      'dairy_farm',             'medium',   'awaiting_review',        'demo',  920.00, FALSE, 'Riverplain Dairy Cooperative', 'Dairy unit 40'),                -- Waikato, New Zealand
    (-18.0950, 178.4600, '2026-08-06T19:10:00Z',  130.00, 0.6300, 'waste_management','landfill',               'low',      'detected',               'demo', 1380.00, FALSE, 'Pacific Island Waste Services','Landfill site 1'),              -- Suva, Fiji
    (-22.2600, 166.4500, '2026-07-15T06:25:00Z',  225.00, 0.7100, 'waste_management','landfill',               'low',      'action_assigned',        'demo',  760.00, FALSE, 'Pacific Island Waste Services','Landfill site 2'),              -- Noumea, New Caledonia
    (13.4400,  144.7800, '2026-06-12T12:40:00Z',  175.00, 0.6900, 'waste_management','landfill',               'low',      'resolved',               'demo',  840.00, FALSE, 'Pacific Island Waste Services','Landfill site 3');              -- Guam

COMMIT;

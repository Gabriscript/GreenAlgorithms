/* Incident API adapter: turns the rows of GET /incidents into the shape the app reads (see "Data contract" in the README).
   The API has no country, so it is found from the coordinates with the country shapes the map already uses.
   MRS_ADAPT(rows, interventions, { live, version }) -> data      pure; run MRS_ADAPT.check() in the console to test the rules
   MRS_FROM_API(url, interventions) -> data    fetch, then adapt */
(() => {
  'use strict';
  const text = s => String(s ?? '').toLowerCase().replace(/[_-]+/g, ' ');   // 'oil_and_gas' and 'oil and gas' read the same
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const nice = s => { const t = String(s ?? '').replace(/[_-]+/g, ' ').replace(/\blng\b/gi, 'LNG').trim(); return t && t.toLowerCase() !== 'string' ? t[0].toUpperCase() + t.slice(1) : ''; };   // 'string' is the Swagger placeholder

  // ---------- country from coordinates ----------
  let shapes = null;
  const index = () => shapes || (shapes = (window.MRS_COUNTRIES?.features || []).map(f => {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
    for (const p of polys) for (const [x, y] of p[0]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    return { iso: f.properties.iso, name: f.properties.name, polys, box: [x0, y0, x1, y1] };
  }));
  const inRing = (x, y, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
  const inside = (x, y, polys) => polys.some(p => inRing(x, y, p[0]) && !p.slice(1).some(h => inRing(x, y, h)));

  function whereIs(lon, lat) {
    const all = index();
    for (const c of all) if (lon >= c.box[0] && lon <= c.box[2] && lat >= c.box[1] && lat <= c.box[3] && inside(lon, lat, c.polys)) return c;
    // not on land (an offshore platform, say): the nearest coast within about 500 km
    const k = Math.cos(lat * Math.PI / 180); let best = null, bd = 25;   // squared degrees
    for (const c of all) {
      if (lon < c.box[0] - 6 || lon > c.box[2] + 6 || lat < c.box[1] - 6 || lat > c.box[3] + 6) continue;
      for (const p of c.polys) for (const [x, y] of p[0]) { const d = ((x - lon) * k) ** 2 + (y - lat) ** 2; if (d < bd) { bd = d; best = c; } }
    }
    return best;
  }

  // ---------- words to the app's categories ----------
  // the most specific word wins: pass source_type before sector. Gas before coal, so 'coal_seam_gas_field' is oil and gas;
  // only coal counts as coal, so the database's 'mining' / 'iron_ore_mine' is Other
  const SECTOR_WORDS = [
    ['wastewater', /waste ?water|sewage|sewer|effluent/],
    ['landfill', /landfill|dump|\bwaste\b/],
    ['livestock', /livestock|cattle|dairy|manure|farm|agricultur|feedlot/],
    ['oil_gas', /\boil\b|\bgas\b|petrol|pipeline|\bwell|compressor|flar|lng|refiner|energy|fossil/],
    ['coal', /coal/],
  ];
  const sectorOf = (...v) => {
    for (const s of v) { const t = text(s), hit = SECTOR_WORDS.find(([, re]) => re.test(t)); if (hit) return hit[0]; }
    return 'other';
  };

  // red detected or awaiting review, orange assigned, yellow repair or verification pending, green verified;
  // the order of the tests matters ('unassigned' contains 'assign', 'awaiting_review' contains 'await')
  const statusOf = v => {
    const s = text(v);
    return /reopen/.test(s) ? 'reopened'
      : /unassign|detect|review|^new$|^open$/.test(s) ? 'new'
      : /resolv|verified|closed|complete/.test(s) && !/pending|await|wait/.test(s) ? 'verified'
      : /repair|verif|pending|await|fix/.test(s) ? 'fixed'
      : /assign|investigat|dispatch|progress|work/.test(s) ? 'assigned'
      : 'new';
  };

  const priorityOf = v => { const s = text(v); return /crit|urgent|severe|very/.test(s) ? 1 : /high/.test(s) ? 2 : /med|mod/.test(s) ? 3 : /low|minor/.test(s) ? 4 : null; };

  // ---------- rows to data ----------
  function adapt(rows, interventions, o = {}) {
    const fake = rows.filter(r => r.is_real === false).length;
    const asOf = Math.max(Date.now(), ...rows.map(r => Date.parse(r.detected_at)).filter(Number.isFinite));
    const hotspots = rows.map(r => {
      const lat = +r.latitude, lon = +r.longitude, c = Number.isFinite(lat) && Number.isFinite(lon) ? whereIs(lon, lat) : null;
      const conf = r.confidence == null ? null : clamp(r.confidence > 1 ? r.confidence / 100 : r.confidence, 0, 1);
      return {
        id: /^\d+$/.test(String(r.id)) ? `MIRA-${String(r.id).padStart(4, '0')}` : String(r.id),
        lat, lon, iso: c ? c.iso : '???', country: c ? c.name : 'Open sea',
        sector: sectorOf(r.source_type, r.sector), detectedAt: r.detected_at, rateKgH: +r.emission_rate_kg_hr,
        satellite: r.satellite_source || undefined, real: r.is_real !== false, locationUncertaintyM: r.location_uncertainty_m || null,
        // attribution: read as soon as the database has these columns (it has neither yet)
        operator: String(r.operator ?? r.operator_name ?? '').trim(),
        uncertaintyKgH: r.emission_rate_uncertainty_kg_hr == null ? null : +r.emission_rate_uncertainty_kg_hr,
        // a public detection names its dataset, which is also the credit its licence asks for
        source: { name: r.facility_name ? `${String(r.facility_name).trim()} (${text(r.source_type).replace(/\blng\b/g, 'LNG')})` : nice(r.source_type), confidence: conf,
          evidence: r.data_source ? `Detection data: ${String(r.data_source).trim()}${/\bSRON\b/.test(r.data_source) ? ', product by the SRON team, contains modified Copernicus Sentinel-5P data' : ''}.` : '' },
        ticket: { status: statusOf(r.status), priority: priorityOf(r.severity) },
      };
    });
    return {
      // live: the database is the truth, so no saved demo state goes on top. The offline copy in data.js passes live: false
      meta: { asOf: new Date(asOf).toISOString(), version: o.version || 'api', live: o.live ?? true, simulated: true, placeholder: rows.length > 0 && fake === rows.length, note: fake && fake < rows.length ? 'Partly simulated' : '' },
      hotspots, interventions: interventions || {},
    };
  }

  // a runnable check of the rules above: MRS_ADAPT.check() in the console throws on the first one that breaks
  adapt.check = () => {
    const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: expected ${b}, got ${a}`); };
    for (const [s, want] of [['detected', 'new'], ['unassigned', 'new'], ['assigned', 'assigned'], ['investigating', 'assigned'], ['repair_pending', 'fixed'], ['Verification pending', 'fixed'], ['verified', 'verified'], ['resolved', 'verified'], ['reopened', 'reopened']]) eq(statusOf(s), want, `status "${s}"`);
    // the seven statuses the backend allows (src/backend/schemas.py)
    for (const [s, want] of [['detected', 'new'], ['awaiting_review', 'new'], ['investigating', 'assigned'], ['action_assigned', 'assigned'], ['repair_in_progress', 'fixed'], ['awaiting_verification', 'fixed'], ['resolved', 'verified']]) eq(statusOf(s), want, `backend status "${s}"`);
    for (const [s, want] of [['oil_and_gas', 'oil_gas'], ['coal_mine', 'coal'], ['landfill', 'landfill'], ['Wastewater plant', 'wastewater'], ['dairy farm', 'livestock'], ['string', 'other']]) eq(sectorOf(s), want, `sector "${s}"`);
    // source_type, sector pairs from the backend seed
    for (const [st, s, want] of [['offshore_platform', 'oil_and_gas', 'oil_gas'], ['coal_seam_gas_field', 'oil_and_gas', 'oil_gas'], ['underground_coal_mine', 'coal_mining', 'coal'], ['wastewater_plant', 'waste_management', 'wastewater'], ['landfill', 'waste_management', 'landfill'], ['feedlot', 'agriculture', 'livestock'], ['iron_ore_mine', 'mining', 'other']]) eq(sectorOf(st, s), want, `source "${st}" in "${s}"`);
    eq(priorityOf('critical'), 1, 'severity critical'); eq(priorityOf('low'), 4, 'severity low'); eq(priorityOf('string'), null, 'unknown severity');
    const at = (lat, lon, extra = {}) => adapt([{ id: 7, latitude: lat, longitude: lon, detected_at: '2026-10-02T11:45:24.682Z', emission_rate_kg_hr: 900, status: 'detected', is_real: true, ...extra }], {}).hotspots[0];
    eq(at(31.9, -102.1).iso, 'USA', 'a point in Texas'); eq(at(31.9, -102.1).id, 'MIRA-0007', 'numeric ids are padded');
    eq(at(27, -91).iso, 'USA', 'an offshore point is given the nearest coast'); eq(at(0, -140).iso, '???', 'mid-ocean has no country');
    eq(at(10, 8, { confidence: 87 }).source.confidence, .87, 'a percentage becomes a share');
    eq(at(10, 8, { operator: ' Acme Gas ' }).operator, 'Acme Gas', 'the operator is read when the database has it');
    eq(at(10, 8, { emission_rate_uncertainty_kg_hr: 4000 }).uncertaintyKgH, 4000, 'the rate uncertainty is read');
    eq(at(10, 8, { confidence: null }).source.confidence, null, 'an unattributed detection has no confidence');
    eq(at(10, 8, { facility_name: 'Station 4', source_type: 'gas_field' }).source.name, 'Station 4 (gas field)', 'a facility name leads the source');
    eq(at(10, 8, { facility_name: 'Train 2', source_type: 'lng_facility' }).source.name, 'Train 2 (LNG facility)', 'LNG keeps its capitals');
    eq(adapt([{ id: 1, latitude: 1, longitude: 1, detected_at: '2026-10-02T00:00:00Z', emission_rate_kg_hr: 1, is_real: false }], {}).meta.placeholder, true, 'all simulated rows mean placeholder data');
    return 'MRS_ADAPT.check(): every rule holds';
  };

  window.MRS_ADAPT = adapt;
  window.MRS_FROM_API = async (url, interventions) => {
    const u = /\/incidents\/?$|\.json$/.test(url) ? url : `${url.replace(/\/$/, '')}/incidents`;   // a base address, the list endpoint, or a saved .json file
    const res = await fetch(u, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`${u} answered ${res.status}`);
    const rows = await res.json();
    if (!Array.isArray(rows)) throw new Error(`${u} did not return a list`);
    return adapt(rows, interventions);
  };
})();

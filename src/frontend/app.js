/* MIRA (Methane Incident Response & Action): front-end prototype. Plain JS, no build step.
   Flow: detection -> ticket -> dispatch -> fix logged -> satellite pass -> verified (green) or reopened (red).
   Ticket state lives in localStorage (ponytail: stands in for the backend). Data comes from data.js or MRS.load(json). See README. */
(() => {
  'use strict';

  // ---------- helpers ----------
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const mqReduce = matchMedia('(prefers-reduced-motion: reduce)'), mqWide = matchMedia('(min-width: 881px)'), mqLone = matchMedia('(max-width: 1320px)'), mqSlim = matchMedia('(max-width: 1180px)');
  const reduced = () => mqReduce.matches;
  const wide = () => mqWide.matches;
  // a stable number in [0, 1) from a string. The last three lines are murmur3's finalizer: plain FNV gives near-equal numbers for names that
  // differ only in the last character ("…cl1", "…cl2"), which made a cloud-blocked ticket stay blocked for ten passes
  const fnv = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
  const rad = Math.PI / 180;
  const DAY = 864e5;
  const nf1 = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 });
  const nf0 = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });
  const fDay = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const fFull = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

  // ---------- model constants ----------
  const SECTORS = {
    oil_gas: { label: 'Oil & gas', icon: 'i-flame', fossil: true },
    coal: { label: 'Coal mining', icon: 'i-mine', fossil: true },
    landfill: { label: 'Landfill', icon: 'i-bin' },
    wastewater: { label: 'Wastewater', icon: 'i-drop' },
    livestock: { label: 'Livestock', icon: 'i-leaf' },
    other: { label: 'Other', icon: 'i-other' },
  };
  const GWP = { fossil: { 100: 29.8, 20: 82.5 }, bio: { 100: 27.0, 20: 79.7 } };   // IPCC AR6, methane
  const CAR_KG = 4600;                                 // kg CO2e one passenger car emits in a year
  const SLA = { 1: 7, 2: 14, 3: 30, 4: 60 };           // days allowed to fix, by priority
  const PRI = { 1: 'Critical', 2: 'High', 3: 'Medium', 4: 'Low' };
  const VERIFY = 0.7;                                  // verified once a clear pass shows the plume 70% or more below baseline
  const PASS_DAYS = 3;                                 // simulated revisit interval
  const STATUS = {
    new: { label: 'Detected', short: 'Detected', group: 'open', g: 'g-open' },
    assigned: { label: 'Assigned', short: 'Assigned', group: 'work', g: 'g-asg' },
    fixed: { label: 'Awaiting verification', short: 'Awaiting', group: 'wait', g: 'g-wait' },
    verified: { label: 'Verified', short: 'Verified', group: 'ok', g: 'g-ok' },
    reopened: { label: 'Reopened', short: 'Reopened', group: 'open', g: 'g-re' },
  };
  const GROUP = { open: { cls: 's-open' }, work: { cls: 's-work' }, wait: { cls: 's-wait' }, ok: { cls: 's-ok' } };   // red, orange, yellow, green
  const CO2E = 'CO<sub>2</sub>e';
  const sec = k => SECTORS[k] || SECTORS.other;

  // on-site inspection, per source type: what the operator checks to find the broken component. [id, component, what to check]
  const INSPECT = {
    oil_gas: [
      ['hatch', 'Tank hatches and vents', 'Scan thief hatches, pressure-relief valves and vent lines with an optical gas imaging camera.'],
      ['pneu', 'Pneumatic controllers and pumps', 'Check gas-driven controllers and chemical-injection pumps for continuous bleed.'],
      ['comp', 'Compressor seals and rod packing', 'Measure vent flow from seals and packing against the maker’s limit.'],
      ['flare', 'Flare or combustor', 'Confirm the pilot is lit and the flare is not venting unburned gas.'],
      ['line', 'Pipeline, valves and connectors', 'Survey flanges, valves and connectors, and soap-test suspect joints.'],
    ],
    coal: [
      ['shaft', 'Ventilation shafts and fans', 'Measure methane concentration and airflow at each ventilation outlet.'],
      ['drain', 'Gas drainage system', 'Check drainage boreholes, pipework and vacuum pumps for leaks.'],
      ['seal', 'Old workings and seals', 'Inspect the sealed shafts and portals of abandoned workings for venting.'],
      ['use', 'Flare or gas-use unit', 'Confirm it is running and the drained gas is not bypassing it.'],
    ],
    landfill: [
      ['cover', 'Cover and cap', 'Walk the surface-emission grid and look for cracks, erosion and exposed waste.'],
      ['well', 'Gas collection wells', 'Check wellheads for vacuum, damaged seals and flooded wells.'],
      ['pipe', 'Header pipes and blower', 'Check the collection pipework and the blower for leaks or downtime.'],
      ['flare', 'Flare or engine', 'Confirm it runs and burns all the gas it receives.'],
      ['face', 'Active tipping face', 'Measure how much fresh waste is left uncovered.'],
    ],
    wastewater: [
      ['digest', 'Digesters and gas holder', 'Check roof seals, pressure-relief valves and the gas holder.'],
      ['gas', 'Biogas pipework and flare', 'Survey the biogas lines and confirm the flare is lit.'],
      ['sludge', 'Sludge tanks and lagoons', 'Look for bubbling or breaks in the crust on open sludge storage.'],
      ['inlet', 'Inlet works and channels', 'Check for septic, low-oxygen conditions where the sewage arrives.'],
    ],
    livestock: [
      ['store', 'Manure storage and lagoons', 'Check covers, crust and overflow on the manure stores.'],
      ['digest', 'Digester and biogas line', 'Check the seals and confirm the flare is lit.'],
      ['house', 'Housing and ventilation', 'Measure methane at ventilation exhausts and check how often manure is cleared.'],
      ['herd', 'Herd and feed records', 'Compare the herd size and feed with the permit.'],
    ],
    other: [
      ['walk', 'Site walk with a gas detector', 'Survey the whole site with a handheld detector or an imaging camera.'],
      ['vent', 'Process vents and stacks', 'Check vents and stacks for unburned gas.'],
      ['store', 'Storage and tanks', 'Inspect tanks and storage areas for leaks.'],
      ['log', 'Operating records', 'Look for upsets or maintenance around the detection date.'],
    ],
  };
  const stepsOf = h => INSPECT[h.sector] || INSPECT.other;

  // ---------- state ----------
  let D, ASOF, KB = {};
  let H = [];                      // detections: facts about each plume
  const HM = new Map();            // id -> detection
  let T = {};                      // id -> ticket state (what the regulator and the satellites change)
  let sim = { day: 0, n: 0 };      // simulated satellite clock: days after ASOF, passes run
  let cStats = new Map();
  const ui = { tab: 'tickets', status: 'all', sector: '', country: '', q: '', sel: null, draft: {}, sheet: 'mid', still: false, theme: 'dark' };
  const calm = () => reduced() || ui.still;   // ambient motion is off: the OS asks for it, or the viewer paused it
  let map = null, mapReady = false;

  // ---------- formatting ----------
  const pct = r => `${Math.round(r * 100)}%`;
  const NB = ' ';   // keeps a number and its unit on one line
  const fmtRate = kg => (kg >= 1000 ? `${nf1.format(kg / 1000)}${NB}t/h` : `${nf0.format(kg)}${NB}kg/h`);
  const fmtT = t => (t >= 1e6 ? `${nf1.format(t / 1e6)}${NB}Mt` : t >= 1e3 ? `${nf1.format(t / 1e3)}${NB}kt` : `${nf0.format(t)}${NB}t`);
  const fmtCost = ([lo, hi]) => { const f = v => (v >= 1000 ? `${nf1.format(v / 1000)}M` : `${nf0.format(v)}k`); return `$${f(lo)} to $${f(hi)}`; };
  const fmtCars = n => (n >= 1e6 ? `${nf1.format(n / 1e6)} million` : nf0.format(Math.round(n / 1000) * 1000 || Math.round(n)));
  const coords = h => `${Math.abs(h.lat).toFixed(2)}°${h.lat >= 0 ? 'N' : 'S'} ${Math.abs(h.lon).toFixed(2)}°${h.lon >= 0 ? 'E' : 'W'}`;
  const fmtM = m => (m >= 1000 ? `${nf1.format(m / 1000)}${NB}km` : `${nf0.format(m)}${NB}m`);

  // ---------- data in ----------
  const ms = v => (typeof v === 'number' ? v : Date.parse(v));
  const normPass = p => ({ t: ms(p.date ?? p.t), rate: p.rateKgH ?? p.rate ?? null, note: p.note || '' });

  function normalise(r) {
    const h = {
      id: String(r.id), lat: +r.lat, lon: +r.lon, iso: r.iso || '???', country: r.country || r.iso || 'Unknown', region: r.region || '',
      sector: SECTORS[r.sector] ? r.sector : 'other', det: ms(r.detectedAt), sat: r.satellite || 'Satellite',
      rate: +r.rateKgH, unc: r.uncertaintyKgH ?? null, pers: clamp(r.persistence ?? .5, .05, 1), operator: r.operator || '',
      source: r.source || {}, passes: (r.passes || []).map(normPass).filter(p => !isNaN(p.t)), seed: r.ticket || null,
      real: r.real !== false, locUnc: r.locationUncertaintyM ?? null,   // real: false marks a simulated detection
    };
    if (!h.passes.length) h.passes.push({ t: h.det, rate: h.rate, note: '' });   // no readings supplied: the detection is the first one, so the chart and table are never empty
    return h.rate > 0 && !isNaN(h.lat) && !isNaN(h.lon) && !isNaN(h.det) ? h : null;
  }

  function seedTicket(h) {
    const s = h.seed || {};
    const t = {
      status: STATUS[s.status] ? s.status : 'new', priority: s.priority || null, assignee: s.assignee || '', fixId: s.fixId || '',
      // a ticket that arrives with its fix reported but no date (the database has none): reported by the time the data was loaded, so later passes count as checks of it
      assignedAt: s.assignedAt ? ms(s.assignedAt) : null, fixAt: s.fixAt ? ms(s.fixAt) : s.status === 'fixed' ? ASOF : null, fate: s.fate || null,
      events: (s.events || []).map(e => ({ t: ms(e.t), text: String(e.text) })), passes: (s.passes || []).map(normPass),
    };
    if (!t.events.length) t.events.push({ t: h.det, text: `Detected by ${h.sat} at ${fmtRate(h.rate)}` });
    return t;
  }

  const dataNote = () => (D.meta?.placeholder ? 'Placeholder data' : D.meta?.note || '');   // the pill that says the data is not all real
  const KEY = () => `mrs:${D.meta?.version || 'dev'}`;
  const save = () => { try { localStorage.setItem(KEY(), JSON.stringify({ sim, T })); } catch (e) { /* private mode: state just won't persist */ } };
  function restore() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY()));
      if (!s || !s.T) return;
      for (const id in s.T) { const t = s.T[id]; if (T[id] && STATUS[t.status] && Array.isArray(t.events) && Array.isArray(t.passes)) T[id] = t; }
      if (s.sim && Number.isFinite(s.sim.day) && Number.isFinite(s.sim.n)) sim = s.sim;
    } catch (e) { /* corrupt state: start fresh */ }
  }

  function load(raw, o = {}) {
    D = raw; KB = raw.interventions || {};
    ASOF = ms(raw.meta?.asOf) || Date.now();
    H = (raw.hotspots || []).map(normalise).filter(Boolean);
    HM.clear(); H.forEach(h => HM.set(h.id, h));
    T = {}; sim = { day: 0, n: 0 };
    H.forEach(h => { T[h.id] = seedTicket(h); if (T[h.id].status !== 'new' && !T[h.id].fixId) T[h.id].fixId = options(h)[0]?.id || ''; });
    if (o.restore !== false && !raw.meta?.live) restore(); else { try { localStorage.removeItem(KEY()); } catch (e) { /* ignore */ } }   // live data: the database is the truth, so no saved demo state on top of it
    if (ui.sel && !HM.has(ui.sel)) ui.sel = null;
    $('#ph').textContent = $('#ph-d').textContent = dataNote(); $('#ph').hidden = $('#ph-d').hidden = !dataNote();
    $('#b-pass').hidden = D.meta?.simulated === false;
    const sectors = [...new Set(H.map(h => h.sector))];
    $('#f-sector').innerHTML = `<option value="">All sources</option>${sectors.map(s => `<option value="${s}">${esc(sec(s).label)}</option>`).join('')}`;
    ui.sector = '';
    if (mapReady) { buildLabels(); syncMap(); }
    renderAll();
  }

  // ---------- derived values ----------
  const now = () => ASOF + sim.day * DAY;
  const stOf = h => T[h.id].status;
  const grpOf = h => STATUS[stOf(h)].group;
  const passesOf = h => h.passes.concat(T[h.id].passes).sort((a, b) => a.t - b.t);
  const postFix = h => { const f = T[h.id].fixAt; return f ? passesOf(h).filter(p => p.t > f) : []; };
  const hasPostFix = h => postFix(h).some(p => p.rate != null);
  // last clear reading after the fix; a ticket the data calls verified but gives no reading for counts at the target (see the verdict in stagesHTML)
  const curRate = h => (postFix(h).filter(p => p.rate != null).pop()?.rate ?? (stOf(h) === 'verified' ? h.rate * (1 - VERIFY) : h.rate));
  const remaining = h => (stOf(h) === 'verified' ? curRate(h) : h.rate);                  // only verified reductions count
  const avoided = h => (stOf(h) === 'verified' ? h.rate - curRate(h) : 0);
  const autoPri = h => { const s = h.rate / 1000 * (.6 + h.pers); return s >= 24 ? 1 : s >= 8 ? 2 : s >= 2.5 ? 3 : 4; };
  const priOf = h => T[h.id].priority || autoPri(h);
  const assignees = h => [...new Set([h.operator, 'Field inspectorate', 'Enforcement unit'].filter(Boolean))];

  function impact(h, kg = h.rate) {
    const ch4 = kg * 8760 * h.pers / 1000;                 // tonnes of methane a year at the observed rate
    const g = sec(h.sector).fossil ? GWP.fossil : GWP.bio;
    return { ch4, c100: ch4 * g[100], c20: ch4 * g[20], cars: ch4 * g[100] * 1000 / CAR_KG };
  }

  function options(h) {
    const all = KB[h.sector] || KB.other || [];
    const fit = all.filter(o => h.rate >= (o.minKgH ?? 0) && h.rate <= (o.maxKgH ?? Infinity));
    return (fit.length ? fit : all).slice().sort((a, b) => b.reduction * b.reliability - a.reduction * a.reliability);   // best expected cut first
  }
  const optOf = (h, id) => (KB[h.sector] || KB.other || []).find(o => o.id === id) || options(h)[0];

  // the deadline is for the repair, so it runs only while a ticket is assigned. It counts from the assignment,
  // or from the detection when the data has no assignment date (tickets that arrive from the database already assigned)
  function dueInfo(h) {
    const s = T[h.id];
    if (s.status !== 'assigned') return null;
    const due = (s.assignedAt || h.det) + SLA[priOf(h)] * DAY, left = Math.round((due - now()) / DAY);
    const when = left > 0 ? `in ${left} ${left === 1 ? 'day' : 'days'}` : left === 0 ? 'today' : `${-left} ${left === -1 ? 'day' : 'days'} overdue`;
    return { due, left, text: `Due ${fDay.format(due)}${s.assignedAt ? '' : ' (from detection)'}, ${when}` };
  }
  const late = h => (dueInfo(h)?.left ?? 0) < 0;

  // what the operator found on site and reported; kept on the ticket, so it is saved with it
  const ins = h => T[h.id].inspect || (T[h.id].inspect = { done: [], cause: '', note: '', sensor: null });
  // who answers for a ticket: the operator when the data names one, otherwise whoever it was assigned to
  const partyOf = h => h.operator || T[h.id].assignee || '';

  const sizeK = h => clamp(4 + 1.5 * Math.sqrt(h.rate / 1000), 5, 14) * (wide() ? 1 : .72);   // marker radius in px at the globe view, from the emission rate

  function countryStats() {
    const m = new Map();
    for (const h of H) {
      const c = m.get(h.iso) || { iso: h.iso, name: h.country, n: 0, base: 0, avoided: 0, rem: 0, open: 0, work: 0, wait: 0, ok: 0, bOpen: 0, bWork: 0, bWait: 0, lat: 0, lon: 0, kmax: 0 };
      const g = grpOf(h);
      c.n++; c.base += h.rate; c.avoided += avoided(h); c.rem += remaining(h); c[g]++; c.lat += h.lat; c.lon += h.lon; c.kmax = Math.max(c.kmax, sizeK(h));
      if (g === 'open') c.bOpen += h.rate; else if (g === 'work') c.bWork += h.rate; else if (g === 'wait') c.bWait += h.rate;
      m.set(h.iso, c);
    }
    for (const c of m.values()) { c.p = c.base ? c.avoided / c.base : 0; c.lat /= c.n; c.lon /= c.n; }
    return m;
  }

  function kpis() {
    const k = { base: 0, rem: 0, avoided: 0, n: { open: 0, work: 0, wait: 0, ok: 0 }, total: H.length };
    for (const h of H) { k.base += h.rate; k.rem += remaining(h); k.avoided += impact(h, avoided(h)).c100; k.n[grpOf(h)]++; }
    return k;
  }

  // ---------- actions ----------
  const log = (h, text) => T[h.id].events.push({ t: now(), text });

  function draftOf(h) {
    const s = T[h.id];
    if (ui.draft.id !== h.id) {
      const opts = options(h);
      ui.draft = { id: h.id, fixId: (s.status === 'reopened' ? opts.find(o => o.id !== s.fixId) : opts[0])?.id || '', assignee: s.assignee || h.operator || assignees(h)[0] };
    }
    return ui.draft;
  }

  function dispatch(id, assignee, fixId, o = {}) {
    const h = HM.get(id), s = T[id], d = draftOf(h), fix = optOf(h, fixId || d.fixId);
    if (!fix) return;
    assignee = assignee || d.assignee;
    const again = s.status === 'reopened';
    Object.assign(s, { status: 'assigned', assignee, fixId: fix.id, assignedAt: now(), fate: null, inspect: null });   // a new round starts a new inspection
    log(h, `${again ? 'Assigned again' : 'Assigned'} to ${assignee}: ${fix.name}`);
    ui.draft = {};
    commit({ toast: o.quiet ? '' : 'Ticket assigned', g: 'g-asg', cls: 's-work' });
  }

  // record what the operator found: { done: [step ids], cause: step id, note, sensor: kg/h or null }. The cause counts as checked
  function inspect(id, patch, o = {}) {
    const h = HM.get(id); if (!h) return;
    const r = Object.assign(ins(h), patch), ids = stepsOf(h).map(x => x[0]);
    if (!ids.includes(r.cause)) r.cause = '';
    r.done = ids.filter(x => r.done.includes(x) || x === r.cause);
    save();
    if (o.render !== false && ui.sel === id) renderDrawer();
  }

  function logFix(id, o = {}) {
    const h = HM.get(id), s = T[id], f = optOf(h, s.fixId), r = ins(h), steps = stepsOf(h), cause = steps.find(x => x[0] === r.cause);
    s.status = 'fixed'; s.fixAt = now();
    s.fate = o.fate || (fnv(id + 'fate') < (f ? f.reliability : .7) ? 'ok' : 'fail');      // hidden: whether the fix really works
    if (cause) log(h, `Inspection on site: source found at ${cause[1].toLowerCase()} (${r.done.length} of ${steps.length} checks)`);
    log(h, `Fix logged by ${s.assignee || 'the operator'}: ${f ? f.name : 'fix applied'}${r.note ? `. Report: “${r.note}”` : ''}${r.sensor != null ? `. Ground sensor after repair: ${fmtRate(r.sensor)}` : ''}`);
    commit({ toast: o.quiet ? '' : 'Fix logged. Waiting for the next satellite pass.', g: 'g-wait', cls: 's-wait' });
  }

  function advancePass(o = {}) {
    sim.day += PASS_DAYS; sim.n++;
    const t = now(), out = { verified: [], reopened: [], cloud: [] };
    for (const h of H) {
      const s = T[h.id];
      if (s.status === 'verified' || h.real) continue;   // invented readings never go on a real detection: only a real follow-up pass can verify it
      const cloudy = !o.noCloud && fnv(h.id + 'cl' + sim.n) < .14;
      if (s.status === 'fixed') {
        if (cloudy) { s.passes.push({ t, rate: null, note: 'cloud' }); log(h, `Pass ${sim.n}: cloud cover, no clear reading. Waiting for the next pass.`); out.cloud.push(h); continue; }
        const fate = s.fate || (fnv(h.id + 'fate') < (optOf(h, s.fixId)?.reliability ?? .7) ? 'ok' : 'fail');
        const cut = fate === 'ok' ? .78 + .19 * fnv(h.id + 'r' + sim.n) : .08 + .4 * fnv(h.id + 'r' + sim.n);
        s.passes.push({ t, rate: Math.round(h.rate * (1 - cut)), note: '' });
        if (cut >= VERIFY) { s.status = 'verified'; log(h, `Pass ${sim.n}: ${pct(cut)} below baseline. Verified.`); out.verified.push(h); }
        else { s.status = 'reopened'; log(h, `Pass ${sim.n}: only ${pct(cut)} below baseline. Target missed, ticket reopened.`); out.reopened.push(h); }
      } else {
        s.passes.push({ t, rate: cloudy ? null : Math.round(h.rate * (.88 + .24 * fnv(h.id + 'o' + sim.n))), note: cloudy ? 'cloud' : '' });
      }
    }
    const parts = [];
    if (out.verified.length) parts.push(`${out.verified.length} verified`);
    if (out.reopened.length) parts.push(`${out.reopened.length} reopened`);
    if (out.cloud.length) parts.push(`${out.cloud.length} blocked by cloud`);
    const g = out.verified.length ? ['g-ok', 's-ok'] : out.reopened.length ? ['g-re', 's-open'] : ['g-wait', 's-wait'];
    commit({ toast: `Pass ${sim.n} on ${fDay.format(now())}: ${parts.join(', ') || 'no ticket was waiting for a check'}`, g: g[0], cls: g[1] });
    out.verified.forEach(h => burst(h, css('--ok')));
    out.reopened.forEach(h => burst(h, css('--open')));
    return out;
  }

  function reset(o = {}) {
    load(D, { restore: false });
    ui.country = ''; ui.status = 'all'; ui.q = ''; $('#q').value = '';
    select(null); setTab('tickets');
    if (mapReady) flyHome();
    if (!o.quiet) toast('Demo reset to its starting state');
  }

  function commit(o = {}) {
    save(); renderAll(); syncMap();
    if (o.toast) toast(o.toast, o.g, o.cls);
  }

  // ---------- selection and filters ----------
  function select(id, o = {}) {
    const prev = ui.sel, dr = $('#drawer');
    if (!id && prev && dr.contains(document.activeElement)) $(`.row[data-id="${prev}"]`)?.focus({ preventScroll: true });
    ui.sel = id && HM.has(id) ? id : null;
    if (ui.sel) { stopSpin(); if (!wide()) setSheet('min'); } else if (!wide()) setSheet('mid');
    if (ui.sel !== prev) ui.draft = {};
    renderQueue(); renderDrawer(); syncSel(prev);
    if (mapReady) { if (ui.sel && o.fly !== false) flyTo(HM.get(ui.sel)); else easePads(); }
    if (ui.sel && o.focus) $('#d-title').focus({ preventScroll: true });
    if (ui.sel) scrollInto($('#list'), $(`.row[data-id="${ui.sel}"]`));
  }

  // bring a row into view by scrolling only its list (scrollIntoView also moves overflow:hidden ancestors)
  function scrollInto(box, n) {
    if (!n) return;
    const b = box.getBoundingClientRect(), r = n.getBoundingClientRect();
    if (r.top < b.top) box.scrollTop -= b.top - r.top; else if (r.bottom > b.bottom) box.scrollTop += r.bottom - b.bottom;
  }

  // the URL carries the view: ?status=open&source=landfill&country=TUR&q=...&tab=countries#MIRA-0129 (file:// only allows the hash, so it degrades quietly)
  function syncUrl() {
    const p = new URLSearchParams();
    if (ui.status !== 'all') p.set('status', ui.status);
    if (ui.sector) p.set('source', ui.sector);
    if (ui.country) p.set('country', ui.country);
    if (ui.q) p.set('q', ui.q);
    if (ui.tab !== 'tickets') p.set('tab', ui.tab);
    const qs = p.toString();
    try { history.replaceState(null, '', `${location.pathname}${qs ? `?${qs}` : ''}${ui.sel ? `#${ui.sel}` : ''}`); } catch (e) { /* ignore */ }
  }

  function readUrl(search) {
    const p = new URLSearchParams(search);
    if (['open', 'work', 'wait', 'ok'].includes(p.get('status'))) ui.status = p.get('status');
    if (SECTORS[p.get('source')] && H.some(h => h.sector === p.get('source'))) ui.sector = p.get('source');
    if (H.some(h => h.iso === p.get('country'))) ui.country = p.get('country');
    ui.q = p.get('q') || ''; $('#q').value = ui.q;
    if (TABS.includes(p.get('tab'))) setTab(p.get('tab'));
  }

  const TABS = ['tickets', 'countries', 'compliance'];
  function setTab(tab) {
    ui.tab = tab;
    for (const t of TABS) {
      const on = t === tab;
      $('#tab-' + t).setAttribute('aria-selected', on); $('#tab-' + t).tabIndex = on ? 0 : -1; $('#pane-' + t).hidden = !on;
    }
  }

  function setSheet(v) {
    ui.sheet = v;
    $('#queue').dataset.sheet = v;
    $('#stage').toggleAttribute('data-sheet-min', v === 'min');
    $('#grab').setAttribute('aria-expanded', v !== 'min');
    $('#grab .vh').textContent = v === 'min' ? 'Show more tickets' : 'Show fewer tickets';
    if (mapReady) easePads();
  }

  function focusCountry(iso) {
    if (!cStats.has(iso)) return;
    if (ui.country && ui.country !== iso && mapReady) map.setFeatureState({ source: 'countries', id: ui.country }, { focus: false });
    ui.country = iso; setTab('tickets'); renderQueue(); renderCountries();
    if (!mapReady) return;
    stopSpin();   // the spin's jumpTo would cancel the flight below
    map.setFeatureState({ source: 'countries', id: iso }, { focus: true });
    const hs = H.filter(h => h.iso === iso);
    if (hs.length === 1) map.flyTo({ center: [hs[0].lon, hs[0].lat], zoom: 4.8, padding: pads() });
    else {
      const b = new maplibregl.LngLatBounds(); hs.forEach(h => b.extend([h.lon, h.lat]));
      // the map already carries pads() as its padding and fitting adds the option's padding on top, so pass the margin only (fitBounds with pads() + 50 threw on phones)
      let cam; try { cam = map.cameraForBounds(b, { padding: 50 }); } catch (e) { /* no room to fit: fall back to a fixed zoom */ }
      map.flyTo({ center: cam ? cam.center : b.getCenter(), zoom: cam ? Math.min(cam.zoom, 5.4) : 3, padding: pads(), speed: .9, curve: 1.5 });   // cameraForBounds ignores maxZoom on the globe, so clamp here
    }
  }

  function clearCountry(fly = true) {
    const iso = ui.country; ui.country = '';
    if (mapReady && iso) map.setFeatureState({ source: 'countries', id: iso }, { focus: false });
    renderQueue(); renderCountries();
    if (fly && !ui.sel && mapReady) flyHome();
  }

  function visible(skipStatus) {
    const q = ui.q.trim().toLowerCase();
    return H.filter(h => {
      if (!skipStatus && ui.status !== 'all' && grpOf(h) !== ui.status) return false;
      if (ui.sector && h.sector !== ui.sector) return false;
      if (ui.country && h.iso !== ui.country) return false;
      return !q || `${h.id} ${h.country} ${h.region} ${h.operator} ${T[h.id].assignee} ${sec(h.sector).label}`.toLowerCase().includes(q);
    });
  }
  const RANK = { open: 0, work: 1, wait: 2, ok: 3 };
  const byQueue = (a, b) => RANK[grpOf(a)] - RANK[grpOf(b)] || late(b) - late(a) || priOf(a) - priOf(b) || b.rate - a.rate;   // open work first, overdue first within it, then priority, then size

  // ---------- rendering: header, queue, countries ----------
  function tween(node, to, fmt) {
    const from = node._v ?? 0; node._v = to; cancelAnimationFrame(node._raf);
    if (calm() || from === to) { node.textContent = fmt(to); return; }
    const t0 = performance.now();
    const step = t => { const k = clamp((t - t0) / 700, 0, 1); node.textContent = fmt(from + (to - from) * (1 - Math.pow(1 - k, 3))); if (k < 1) node._raf = requestAnimationFrame(step); };
    node._raf = requestAnimationFrame(step);
  }

  function renderHeader() {
    const k = kpis(), down = k.base ? 1 - k.rem / k.base : 0;
    tween($('#k-rem'), k.rem, fmtRate);
    const d = $('#k-rem-d');
    d.textContent = down >= .0005 ? `${nf1.format(down * 100)}% below baseline` : 'No verified fixes yet';
    d.classList.toggle('good', down >= .0005);
    tween($('#k-avoid'), k.avoided, fmtT);
    $('#k-ver').textContent = `${k.n.ok} of ${k.total}`;
    const m = $('#k-meter');
    m.innerHTML = `<i class="s-open" style="--n:${k.n.open}"></i><i class="s-work" style="--n:${k.n.work}"></i><i class="s-wait" style="--n:${k.n.wait}"></i><i class="s-ok" style="--n:${k.n.ok}"></i>`;
    m.setAttribute('aria-label', `${k.n.open} detected, ${k.n.work} assigned, ${k.n.wait} awaiting verification, ${k.n.ok} verified`);
    $('#clock-d').textContent = `${fFull.format(now())}, pass ${sim.n}`;
  }

  function row(h) {
    const s = T[h.id], st = STATUS[s.status], p = priOf(h), sc = sec(h.sector);
    const rate = s.status === 'verified' ? curRate(h) : h.rate;
    const [v, u] = rate >= 1000 ? [nf1.format(rate / 1000), 't/h'] : [nf0.format(rate), 'kg/h'];
    // no aria-label: the visible text is the accessible name (WCAG label-in-name); the hidden word only gives "P1" its meaning
    return `<li><button class="row${st.group === 'ok' ? ' done' : ''}" type="button" data-id="${esc(h.id)}" aria-current="${ui.sel === h.id}">` +
      `<span class="pri p${p}"><span class="vh">Priority </span>P${p}</span>` +
      `<span class="r-t"><b>${esc(h.country)}</b><span>${esc(h.region)}</span></span>` +
      `<span class="r-v">${v}<small> ${u}</small></span>` +
      `<span class="r-m"><svg class="ic" aria-hidden="true"><use href="#${sc.icon}"/></svg><span>${esc(sc.label)}</span><span class="who">${esc(s.assignee || (st.group === 'open' ? 'Unassigned' : 'No assignee recorded'))}</span>${late(h) ? '<span class="late"><svg class="ic" aria-hidden="true"><use href="#i-clock"/></svg>Overdue</span>' : ''}</span>` +
      `<span class="r-s"><svg class="gl ${GROUP[st.group].cls}" aria-hidden="true"><use href="#${st.g}"/></svg>${esc(st.short)}</span></button></li>`;
  }

  function renderQueue() {
    const list = $('#list'), keep = document.activeElement?.closest?.('#list') ? document.activeElement.dataset.id : null, top = list.scrollTop;
    const base = visible(true), cnt = { all: base.length, open: 0, work: 0, wait: 0, ok: 0 };
    base.forEach(h => cnt[grpOf(h)]++);
    const chips = [['all', 'All'], ['open', 'Detected'], ['work', 'Assigned'], ['wait', 'Awaiting'], ['ok', 'Verified']];
    const box = $('#chips');
    if (!box.children.length) box.innerHTML = chips.map(([k, l]) => `<button class="chip" type="button" data-s="${k}">${l}<span class="n"></span></button>`).join('');
    [...box.children].forEach(b => { b.setAttribute('aria-pressed', ui.status === b.dataset.s); b.lastChild.textContent = cnt[b.dataset.s]; });
    $('#f-sector').value = ui.sector;
    const sc = $('#scope');
    sc.hidden = !ui.country;
    if (ui.country) sc.innerHTML = `Showing<button class="chip" type="button" data-act="unscope" aria-label="Show all countries again">${esc(cStats.get(ui.country)?.name || ui.country)}<svg class="ic" aria-hidden="true"><use href="#i-close"/></svg></button>`;
    const rows = base.filter(h => ui.status === 'all' || grpOf(h) === ui.status).sort(byQueue);
    const filtered = ui.status !== 'all' || ui.sector || ui.country || ui.q;
    list.innerHTML = rows.length ? rows.map(row).join('') : `<li class="empty"><p>No tickets match these filters.</p><button class="link" type="button" data-act="clear">Clear filters</button></li>`;
    list.scrollTop = top;
    $('#foot').innerHTML = `<span>${rows.length} of ${H.length} tickets</span>${dataNote() ? `<span class="ph-m">${esc(dataNote())}</span>` : ''}${filtered ? '<button class="link" type="button" data-act="clear">Clear filters</button>' : ''}`;
    syncUrl();
    $('#n-tickets').textContent = H.length;
    if (keep) $(`#list .row[data-id="${keep}"]`)?.focus({ preventScroll: true });
  }

  function renderCountries() {
    cStats = countryStats();
    const cs = [...cStats.values()].sort((a, b) => b.rem - a.rem);
    $('#n-countries').textContent = cs.length;
    const keep = document.activeElement?.closest?.('#clist') ? document.activeElement.dataset.iso : null;
    $('#clist').innerHTML = cs.map(c => `<li><button class="row crow" type="button" data-iso="${esc(c.iso)}" aria-current="${ui.country === c.iso}">` +
      `<span class="c-n">${esc(c.name)}</span><span class="c-p">${Math.round(c.p * 100)}<small>% verified</small></span>` +
      `<span class="cbar" aria-hidden="true"><i class="s-open" style="--n:${Math.round(c.bOpen)}"></i><i class="s-work" style="--n:${Math.round(c.bWork)}"></i><i class="s-wait" style="--n:${Math.round(c.bWait)}"></i><i class="s-ok" style="--n:${Math.round(c.avoided)}"></i><i style="--n:${Math.max(0, Math.round(c.base - c.bOpen - c.bWork - c.bWait - c.avoided))}"></i></span>` +
      `<span class="c-m"><span>${c.n} ${c.n === 1 ? 'ticket' : 'tickets'}</span><span>${fmtRate(c.rem)} remaining</span></span></button></li>`).join('');
    if (keep) $(`#clist .row[data-iso="${keep}"]`)?.focus({ preventScroll: true });
  }

  // compliance: per operator (or assignee when the data names no operator), how many tickets are overdue or failed verification
  function partyStats() {
    const m = new Map();
    for (const h of H) {
      const s = T[h.id], name = partyOf(h), key = name || (s.status === 'new' ? 'Unassigned' : 'Operator not recorded');
      const p = m.get(key) || { name: key, named: !!name, n: 0, open: 0, work: 0, wait: 0, ok: 0, late: 0, re: 0 };
      p.n++; p[grpOf(h)]++; if (late(h)) p.late++; if (s.status === 'reopened') p.re++;
      m.set(key, p);
    }
    // on track: of the tickets past detection (reopened ones included), the share neither overdue nor reopened
    for (const p of m.values()) { const acted = p.n - p.open + p.re; p.acted = acted; p.track = acted ? (acted - p.late - p.re) / acted : null; }
    return [...m.values()].sort((a, b) => b.named - a.named || b.late + b.re - a.late - a.re || b.n - a.n);
  }

  function renderCompliance() {
    const ps = partyStats(), t = ps.reduce((a, p) => ({ late: a.late + p.late, re: a.re + p.re, acted: a.acted + p.acted }), { late: 0, re: 0, acted: 0 });
    $('#n-compliance').textContent = ps.length;
    $('#cmp-sum').innerHTML = `<span><b>${t.late}</b> overdue</span><span><b>${t.re}</b> reopened</span><span><b>${t.acted ? pct((t.acted - t.late - t.re) / t.acted) : '—'}</b> of assigned tickets on track</span>`;
    const keep = document.activeElement?.closest?.('#plist') ? document.activeElement.dataset.party : null;
    $('#plist').innerHTML = ps.map(p => {
      const body = `<span class="c-n">${esc(p.name)}</span><span class="c-p">${p.track == null ? '—' : `${Math.round(p.track * 100)}<small>% on track</small>`}</span>` +
        `<span class="cbar" aria-hidden="true"><i class="s-open" style="--n:${p.open}"></i><i class="s-work" style="--n:${p.work}"></i><i class="s-wait" style="--n:${p.wait}"></i><i class="s-ok" style="--n:${p.ok}"></i></span>` +
        `<span class="c-m"><span>${p.n} ${p.n === 1 ? 'ticket' : 'tickets'}</span>${p.late ? `<span class="late"><svg class="ic" aria-hidden="true"><use href="#i-clock"/></svg>${p.late} overdue</span>` : ''}${p.re ? `<span>${p.re} reopened</span>` : ''}<span>${p.ok} verified</span></span>`;
      // a named party opens its tickets; the catch-all rows are not a search anyone can run
      return p.named ? `<li><button class="row crow" type="button" data-party="${esc(p.name)}">${body}</button></li>` : `<li><div class="row crow anon">${body}</div></li>`;
    }).join('');
    if (keep) $(`#plist .row[data-party="${CSS.escape(keep)}"]`)?.focus({ preventScroll: true });
  }

  // the evidence trail as CSV: one line per event, with the ticket's checks, report and sensor reading on every line
  const csvCell = v => { let t = String(v ?? ''); if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`; return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };   // a leading = + - @ would run as a spreadsheet formula
  function exportCsv() {
    const head = ['ticket', 'country', 'source', 'status', 'priority', 'operator or assignee', 'due', 'source found at', 'checks done', 'operator report', 'ground sensor kg/h', 'event time (UTC)', 'event'];
    const lines = [];
    for (const h of H.slice().sort(byQueue)) {
      const s = T[h.id], r = ins(h), d = dueInfo(h), steps = stepsOf(h), cause = steps.find(x => x[0] === r.cause);
      const base = [h.id, h.country, `${sec(h.sector).label}${h.source.name ? `: ${h.source.name}` : ''}`, STATUS[s.status].label, `P${priOf(h)}`, partyOf(h), d ? new Date(d.due).toISOString().slice(0, 10) : '', cause ? cause[1] : '', `${r.done.length} of ${steps.length}`, r.note, r.sensor ?? ''];
      for (const e of s.events.slice().sort((a, b) => a.t - b.t)) lines.push([...base, new Date(e.t).toISOString(), e.text]);
    }
    const csv = [head, ...lines].map(l => l.map(csvCell).join(',')).join('\r\n');
    const a = el('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));   // the BOM makes Excel read it as UTF-8
    a.download = `mira-evidence-${new Date(now()).toISOString().slice(0, 10)}.csv`;
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast(`Evidence trail downloaded: ${lines.length} entries from ${H.length} tickets`);
  }

  // ---------- rendering: ticket drawer ----------
  let lastShown = null;

  function renderDrawer() {
    const h = HM.get(ui.sel), dr = $('#drawer'), body = $('#d-body');
    $('#stage').dataset.drawer = h ? 'open' : 'closed';
    if (!h) { dr.inert = true; lastShown = null; return; }
    const ae = document.activeElement, keep = dr.contains(ae) ? (ae.id ? `#${ae.id}` : ae.dataset.act ? `[data-act="${ae.dataset.act}"]` : null) : null;   // by id first: the checklist has several boxes with the same action
    const top = lastShown === h.id ? body.scrollTop : 0;
    const s = T[h.id], st = STATUS[s.status], p = priOf(h), due = dueInfo(h), a = autoPri(h);
    dr.inert = false;
    $('#d-head').innerHTML =
      `<div class="d-top"><span class="d-id" translate="no">${esc(h.id)}</span><button class="btn icon sm" type="button" data-act="close" aria-label="Close ticket"><svg class="ic" aria-hidden="true"><use href="#i-close"/></svg></button></div>` +
      `<h2 class="d-title" id="d-title" tabindex="-1">${esc(h.country)}</h2>` +
      `<p class="d-sub">${esc(h.region)}${h.region ? ', ' : ''}${coords(h)}</p>` +
      `<div class="d-meta"><span class="st"><svg class="gl ${GROUP[st.group].cls}" aria-hidden="true"><use href="#${st.g}"/></svg>${esc(st.label)}</span>` +
      `<label class="pri-sel"><span class="vh">Priority</span><select name="priority" data-act="pri"><option value="">Auto: P${a} ${PRI[a]}</option>${[1, 2, 3, 4].map(n => `<option value="${n}"${s.priority === n ? ' selected' : ''}>P${n} ${PRI[n]}</option>`).join('')}</select></label>` +
      `${due ? `<span class="due"><svg class="ic" aria-hidden="true"><use href="#i-clock"/></svg>${esc(due.text)}</span>` : ''}${h.real ? '' : '<span class="ph">Simulated detection</span>'}</div>`;
    body.innerHTML = stagesHTML(h, p);
    $('#d-foot').innerHTML = footHTML(h);
    body.scrollTop = top; lastShown = h.id;
    if (keep) ($(`#drawer ${keep}`) || $('#d-title')).focus({ preventScroll: true });
  }

  function stagesHTML(h, p) {
    const s = T[h.id], st = s.status, sc = sec(h.sector), src = h.source, I = impact(h), opts = options(h), d = draftOf(h);
    const editable = st === 'new' || st === 'reopened', red = 1 - curRate(h) / h.rate, due = dueInfo(h);
    const node = (kind, n) => `<span class="node ${kind}">${kind === 'done' ? '<svg class="ic" aria-hidden="true"><use href="#i-check"/></svg>' : kind === 'bad' ? '<svg class="gl s-open" aria-hidden="true"><use href="#g-re"/></svg>' : n}</span>`;
    const alts = (src.alternatives || []).filter(x => x.confidence > 0).map(x => `${esc(sec(x.sector).label)} ${pct(x.confidence)}`).join(', ');

    const s1 = `<section class="stg" aria-labelledby="h-src"><div class="rail">${node('done')}</div><div class="stg-b">` +
      `<div class="st-h"><h3 id="h-src">Likely source</h3><span class="state">Matched from the plume</span></div>` +
      `<p class="src-name"><svg class="ic" aria-hidden="true"><use href="#${sc.icon}"/></svg>${esc(sc.label)}${src.name ? `: ${esc(src.name)}` : ''}</p>` +
      `${src.confidence != null ? `<div class="conf"><span>Confidence</span><span class="trk"><i style="width:${Math.round(src.confidence * 100)}%"></i></span><b>${pct(src.confidence)}</b></div>` : ''}` +
      `${alts ? `<p class="alt">Also possible: ${alts}</p>` : ''}${src.evidence ? `<p class="why">${esc(src.evidence)}</p>` : ''}` +
      `<dl class="kv"><dt>Registered operator</dt><dd>${esc(h.operator || 'Not known')}</dd><dt>First seen</dt><dd>${fFull.format(h.det)} by ${esc(h.sat)}</dd><dt>Location</dt><dd>${coords(h)}${h.locUnc ? `, within ${fmtM(h.locUnc)}` : ''}</dd></dl></div></section>`;

    const s2 = `<section class="stg" aria-labelledby="h-imp"><div class="rail">${node('done')}</div><div class="stg-b">` +
      `<div class="st-h"><h3 id="h-imp">Climate impact</h3><span class="state">If it keeps leaking</span></div>` +
      `<p class="big">${fmtT(I.c100)}<small>${CO2E} a year</small></p><ul class="facts">` +
      `<li><b>${fmtT(I.c20)}</b> ${CO2E} a year on a 20-year view, which counts methane’s near-term warming</li>` +
      `<li>About <b>${fmtCars(I.cars)}</b> cars driven for a year</li>` +
      `<li><b>${fmtRate(h.rate)}</b>${h.unc ? `, plus or minus ${fmtRate(h.unc)}` : ''}, seen on <b>${pct(h.pers)}</b> of passes</li>` +
      `${st === 'verified' ? `<li><b>${fmtT(impact(h, avoided(h)).c100)}</b> ${CO2E} a year avoided so far</li>` : ''}</ul></div></section>`;

    const chosen = optOf(h, s.fixId), shown = editable ? opts : [chosen].filter(Boolean);
    const optHTML = shown.map(o => `<label class="opt${editable ? '' : ' locked'}"><input type="radio" name="fix" value="${esc(o.id)}" data-act="pick"${(editable ? d.fixId : s.fixId) === o.id ? ' checked' : ''}${editable ? '' : ' disabled'}>` +
      `<span class="dot" aria-hidden="true"></span><span class="opt-n">${esc(o.name)}${editable && o.id === opts[0].id ? '<span class="tag">Recommended</span>' : ''}</span>` +
      `<span class="opt-m"><span>${pct(o.reduction)} lower if it works</span><span>${fmtCost(o.cost)}</span><span>about ${o.weeks} weeks</span><span>${pct(o.reliability)} success rate</span></span></label>`).join('');
    const n3 = st === 'fixed' || st === 'verified' ? 'done' : 'now';
    const t3 = { new: 'Needs a decision', assigned: 'Waiting for the operator', fixed: 'Fix logged', verified: 'Fix logged', reopened: 'Choose a new fix' }[st];
    const s3 = `<section class="stg" aria-labelledby="h-act"><div class="rail">${node(n3, 3)}</div><div class="stg-b">` +
      `<div class="st-h"><h3 id="h-act">Recommended action</h3><span class="state">${t3}</span></div>` +
      `${!editable && s.assignee ? `<p class="summary">Assigned to <b>${esc(s.assignee)}</b> on ${fDay.format(s.assignedAt)}.${due ? ` ${esc(due.text)}.` : ''}</p>` : ''}` +
      `${st === 'reopened' ? '<p class="summary">The last fix missed its target. Pick another and send it again.</p>' : ''}` +
      `${shown.length ? `<fieldset class="opts"><legend class="vh">Choose a fix</legend>${optHTML}</fieldset>` : '<p class="summary">No ranked fixes for this source type yet. Add some under interventions in data.js.</p>'}` +
      `${editable ? `<div class="fields"><label class="fld"><span>Assign to</span><select name="assignee" data-act="assign">${assignees(h).map(x => `<option${x === d.assignee ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select></label><div class="fld"><span>Due</span><span class="val">${fDay.format(now() + SLA[p] * DAY)}</span></div></div>` : ''}` +
      `</div></section>`;

    // 4. on-site inspection: the operator works through the checks for this kind of site and names the broken component
    const steps = stepsOf(h), r = ins(h), cause = steps.find(x => x[0] === r.cause), onSite = st === 'assigned';
    const n4i = st === 'fixed' || st === 'verified' ? 'done' : onSite ? 'now' : 'todo';
    const t4i = onSite ? `${r.done.length} of ${steps.length} checked` : st === 'new' || st === 'reopened' ? 'Starts after assignment' : cause ? 'Source found' : 'No record';
    const checks = steps.map(([id, name, how]) => `<li><label class="chk"><input type="checkbox" id="chk-${id}" value="${id}" data-act="chk"${r.done.includes(id) ? ' checked' : ''}><span class="box" aria-hidden="true"></span><span class="chk-t"><b>${esc(name)}</b><span>${esc(how)}</span></span></label></li>`).join('');
    const insBody = onSite
      ? `<p class="summary">Work through the checks on site and record where the gas is coming from. The fix can be logged once the source is found.</p>` +
        `<fieldset class="checks"><legend class="vh">On-site checks</legend><ul>${checks}</ul></fieldset>` +
        `<div class="fields one"><label class="fld"><span>Source found at</span><select id="ins-cause" data-act="cause"><option value="">Not found yet</option>${steps.map(([id, name]) => `<option value="${id}"${r.cause === id ? ' selected' : ''}>${esc(name)}</option>`).join('')}</select></label>` +
        `<label class="fld"><span>Operator’s report</span><textarea id="ins-note" data-act="note" rows="2" maxlength="300" placeholder="What was found and repaired">${esc(r.note)}</textarea></label>` +
        `<label class="fld"><span>Ground sensor after the repair, kg/h <i>optional</i></span><input id="ins-sensor" data-act="sensor" type="number" inputmode="decimal" min="0" step="any" value="${r.sensor ?? ''}"></label></div>`
      : st === 'new' || st === 'reopened'
        ? `<p class="summary">Once assigned, the operator works through ${steps.length} checks for ${esc(sc.label.toLowerCase())} sites and records the broken component:</p><ol class="plan">${steps.map(x => `<li>${esc(x[1])}</li>`).join('')}</ol>`
        : cause
          ? `<p class="src-name"><svg class="ic" aria-hidden="true"><use href="#i-check"/></svg>Source found at ${esc(cause[1].toLowerCase())}</p><p class="summary">${r.done.length} of ${steps.length} checks done on site.</p>${r.note ? `<p class="why">“${esc(r.note)}”</p>` : ''}`
          : '<p class="summary">The data has no inspection record for this ticket.</p>';
    const sIns = `<section class="stg" aria-labelledby="h-ins"><div class="rail">${node(n4i, 4)}</div><div class="stg-b">` +
      `<div class="st-h"><h3 id="h-ins">On-site inspection</h3><span class="state" id="ins-n">${t4i}</span></div>${insBody}</div></section>`;

    const n4 = st === 'verified' ? 'done' : st === 'fixed' ? 'now' : st === 'reopened' ? 'bad' : 'todo';
    const t4 = { new: 'Starts after the fix', assigned: 'Starts after the fix', fixed: 'Waiting for the next pass', verified: 'Verified', reopened: 'Target missed' }[st];
    // three sources once a fix is logged: the operator's word, a ground sensor, and the satellite, which alone decides
    const sCut = r.sensor != null ? 1 - r.sensor / h.rate : null, satCut = hasPostFix(h) ? red : null;
    const evid = !s.fixAt || st === 'assigned' || st === 'new' ? '' :
      `<ul class="evid" aria-label="Evidence">` +
      `<li><span class="ev-k">Operator report</span><span>${r.note ? 'Repair reported' : 'Fix logged, no report'}</span><span class="ev-s">Claim</span></li>` +
      `<li><span class="ev-k">Ground sensor</span><span>${sCut != null ? `${fmtRate(r.sensor)}, ${pct(Math.max(0, sCut))} lower` : 'No reading'}</span><span class="ev-s">Supports</span></li>` +
      `<li><span class="ev-k">Satellite</span><span>${satCut != null ? `${pct(Math.max(0, satCut))} lower` : 'Waiting for a clear pass'}</span><span class="ev-s">Decides</span></li></ul>` +
      `${sCut != null && satCut != null && (sCut >= VERIFY) !== (satCut >= VERIFY) ? `<p class="why">The sources disagree: the ground sensor shows ${pct(Math.max(0, sCut))} lower, the satellite ${pct(Math.max(0, satCut))}. The satellite sees the whole site; a sensor by the repaired part can miss gas escaping elsewhere.</p>` : ''}`;
    const verdict = st === 'fixed' && h.real ? '<p class="verdict"><svg class="gl s-wait" aria-hidden="true"><use href="#g-wait"/></svg>Fix logged. This is a real detection, so only a real follow-up pass can verify it; the simulated passes leave it alone.</p>'
      : st === 'fixed' ? '<p class="verdict"><svg class="gl s-wait" aria-hidden="true"><use href="#g-wait"/></svg>Fix logged. The next clear pass decides.</p>'
      : st === 'verified' ? `<p class="verdict"><svg class="gl s-ok" aria-hidden="true"><use href="#g-ok"/></svg>${hasPostFix(h) ? `${pct(red)} lower than baseline. The target was ${pct(VERIFY)}.` : `Marked verified, but the data has no reading. Counted at the ${pct(VERIFY)} target.`}</p>`
      : st === 'reopened' ? `<p class="verdict"><svg class="gl s-open" aria-hidden="true"><use href="#g-re"/></svg>Only ${pct(Math.max(0, red))} lower. The target was ${pct(VERIFY)}, so the ticket is open again.</p>`
      : `<p class="summary">A fix counts once a clear pass shows the plume at least ${pct(VERIFY)} below its baseline of <b>${fmtRate(h.rate)}</b>.</p>`;
    const s4 = `<section class="stg" aria-labelledby="h-ver"><div class="rail">${node(n4, 5)}</div><div class="stg-b">` +
      `<div class="st-h"><h3 id="h-ver">Verification</h3><span class="state">${t4}</span></div>${verdict}${evid}${chartHTML(h)}` +
      `<div class="key"><span><i></i>Before the fix</span><span><i class="ok"></i>Verified</span><span><i class="bad"></i>Missed target</span><span><i class="cloud"></i>Cloud, no reading</span></div>${tableHTML(h)}</div></section>`;

    // newest first; entries logged at the same moment keep their order, latest on top
    const act = `<h3 class="act-h">Activity</h3><ol class="act">${s.events.map((e, i) => [e, i]).sort((x, y) => y[0].t - x[0].t || y[1] - x[1]).map(([e]) => `<li><time datetime="${new Date(e.t).toISOString()}">${fDay.format(e.t)}</time><span>${esc(e.text)}</span></li>`).join('')}</ol>`;
    return s1 + s2 + s3 + sIns + s4 + act;
  }

  function footHTML(h) {
    const s = T[h.id], d = draftOf(h);
    switch (s.status) {
      case 'new': case 'reopened':
        return `<button class="btn primary" type="button" data-act="dispatch"${d.fixId ? '' : ' disabled'}>${s.status === 'new' ? 'Assign ticket' : 'Assign again'}</button><span class="note" style="flex:1 1 0">The operator is notified and the due date starts.</span>`;
      case 'assigned': {
        const found = !!ins(h).cause;
        return `<button class="btn primary" type="button" data-act="fix"${found ? '' : ' disabled'}>Log fix as applied</button><p class="note">${found ? 'Demo shortcut for the operator’s report. In production it arrives from the operator.' : 'Record where the inspection found the source first.'}</p>`;
      }
      case 'fixed':
        return `<button class="btn primary" type="button" data-act="pass">Run next satellite pass</button><p class="note">Checks every ticket that is waiting. Simulated: clouds can block a reading.</p>`;
      default:
        return '<p class="note" style="margin:0">Verified and closed. It now counts toward the totals.</p>';
    }
  }

  // verification chart: emission rate per satellite pass, with the "verified" zone shaded and a table twin below
  const niceMax = v => { const e = 10 ** Math.floor(Math.log10(v)), f = v / e; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * e; };

  function passInfo(h, p) {
    const s = T[h.id], post = s.fixAt && p.t > s.fixAt, cut = p.rate == null ? null : 1 - p.rate / h.rate;
    return {
      date: fDay.format(p.t), rate: p.rate == null ? 'No reading' : fmtRate(p.rate),
      change: post && cut != null ? `${cut >= 0 ? '−' : '+'}${Math.abs(Math.round(cut * 100))}%` : '—',
      reading: p.rate == null ? 'Cloud, no reading' : post ? (cut >= VERIFY ? 'Verified' : 'Below target') : p.t === h.det ? 'First detection' : 'Plume seen',
    };
  }

  function chartHTML(h) {
    const s = T[h.id], ps = passesOf(h), W = 392, HT = 176, L = 42, R = 12, TOP = 16, BOT = 28;
    const t0 = Math.min(h.det, ...ps.map(p => p.t)), t1 = Math.max(now(), ...ps.map(p => p.t)) + PASS_DAYS * DAY * .6;
    const top = niceMax(Math.max(h.rate * 1.1, ...ps.map(p => p.rate || 0)));
    const X = t => L + (t - t0) / (t1 - t0) * (W - L - R), Y = r => TOP + (1 - r / top) * (HT - TOP - BOT);
    const tick = v => (v >= 10000 ? nf0.format(v / 1000) : v >= 1000 ? nf1.format(v / 1000) : String(+(v / 1000).toFixed(2)));
    const tg = h.rate * (1 - VERIFY);
    const grid = [0, .5, 1].map(f => `<line class="axis" x1="${L}" x2="${W - R}" y1="${Y(top * f).toFixed(1)}" y2="${Y(top * f).toFixed(1)}"/><text x="${L - 8}" y="${(Y(top * f) + 4).toFixed(1)}" text-anchor="end">${tick(top * f)}</text>`).join('');
    const xl = [[t0, 'start'], [(t0 + t1) / 2, 'middle'], [t1, 'end']].map(([t, a]) => `<text x="${X(t).toFixed(1)}" y="${HT - 6}" text-anchor="${a}">${fDay.format(t)}</text>`).join('');
    const band = `<rect class="band" x="${L}" y="${Y(tg).toFixed(1)}" width="${W - L - R}" height="${(Y(0) - Y(tg)).toFixed(1)}"/><line class="tgt" x1="${L}" x2="${W - R}" y1="${Y(tg).toFixed(1)}" y2="${Y(tg).toFixed(1)}"/><text class="tl" x="${W - R - 2}" y="${(Y(tg) - 6).toFixed(1)}" text-anchor="end">Verified below this line</text>`;
    const fixX = s.fixAt && s.fixAt >= t0 ? X(s.fixAt) : null;
    const fix = fixX == null ? '' : `<line class="fix" x1="${fixX.toFixed(1)}" x2="${fixX.toFixed(1)}" y1="${TOP}" y2="${Y(0).toFixed(1)}"/><text x="${(fixX + 5).toFixed(1)}" y="${TOP + 8}">Fix logged</text>`;
    const valid = ps.filter(p => p.rate != null);
    const line = valid.length > 1 ? `<polyline class="ln" points="${valid.map(p => `${X(p.t).toFixed(1)},${Y(p.rate).toFixed(1)}`).join(' ')}"/>` : '';
    const dots = ps.map((p, i) => {
      const i2 = passInfo(h, p), post = s.fixAt && p.t > s.fixAt, cut = p.rate == null ? 0 : 1 - p.rate / h.rate;
      const cls = p.rate == null ? 'cloud' : post ? (cut >= VERIFY ? 'ok' : 'bad') : 'pre';
      const cx = X(p.t).toFixed(1), cy = (p.rate == null ? Y(0) : Y(p.rate)).toFixed(1);
      return `<circle class="mk ${cls}" cx="${cx}" cy="${cy}" r="5"/><circle class="hit" cx="${cx}" cy="${cy}" r="18" tabindex="0" role="img" data-i="${i}" aria-label="${esc(`${i2.date}: ${i2.rate}, ${i2.reading}`)}"/>`;
    }).join('');
    return `<svg class="chart" viewBox="0 0 ${W} ${HT}" role="group" aria-label="Emission rate in tonnes per hour at each satellite pass. The table below lists the same readings."><text x="0" y="10">t/h</text>${grid}${band}${fix}${line}${dots}${xl}</svg>`;
  }

  function tableHTML(h) {
    const ps = passesOf(h).slice().reverse();
    const rows = ps.slice(0, 6).map(p => { const i = passInfo(h, p); return `<tr><td>${i.date}</td><td>${i.rate}</td><td>${i.change}</td><td>${i.reading}</td></tr>`; }).join('');
    return `<table class="ptable"><caption>Every pass, newest first</caption><thead><tr><th scope="col">Date</th><th scope="col">Rate</th><th scope="col">Change</th><th scope="col">Reading</th></tr></thead><tbody>${rows}${ps.length > 6 ? `<tr class="more"><td colspan="4">${ps.length - 6} earlier passes not shown</td></tr>` : ''}</tbody></table>`;
  }

  // ---------- toast and tooltip ----------
  function toast(text, g, cls) {
    const box = $('#toasts'), t = el('div', 'toast');
    if (g) t.innerHTML = `<svg class="gl ${cls}" aria-hidden="true"><use href="#${g}"/></svg>`;
    t.append(text);
    box.append(t);
    while (box.children.length > 3) box.firstChild.remove();
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, 4200);
  }

  const tip = $('#tip');
  function showTip(build, ev) {
    tip.replaceChildren(); build(tip); tip.hidden = false;
    const r = tip.getBoundingClientRect();
    tip.style.left = `${Math.max(8, Math.min(ev.clientX + 16, innerWidth - r.width - 8))}px`;
    tip.style.top = `${Math.max(8, Math.min(ev.clientY + 14, innerHeight - r.height - 8))}px`;
  }
  const hideTip = () => { tip.hidden = true; };

  // ---------- map ----------
  const EMPTY = { type: 'FeatureCollection', features: [] };
  const HOME = [40, 24];

  // panel widths come from CSS and change only at a breakpoint: read them once, not on every map frame
  let PW = null;
  const panelW = () => PW || (PW = { qw: parseFloat(css('--qw')) || 376, dw: parseFloat(css('--dw')) || 448 });

  function pads() {
    if (!wide()) return { top: 12, left: 0, right: 0, bottom: ui.sheet === 'min' ? 100 : Math.round(innerHeight * .46) + 12 };
    const gap = 16, { qw, dw } = panelW();
    const lone = ui.sel && mqLone.matches;     // on smaller laptops an open ticket takes the queue's place
    return { top: 24, bottom: 84, left: lone ? gap : qw + gap * 2, right: ui.sel ? dw + gap * 2 : gap };
  }

  function homeZoom() {
    // zoom at which the globe fills the free part of the map. MapLibre's globe is a perspective camera with a 36.87 degree view,
    // so: focal length f = 1.5 * height, apparent radius = R*f / sqrt((R+f)^2 - R^2), and R = 81.49 * 2^zoom / cos(latitude).
    const m = $('#map'), p = pads(), w = m.clientWidth - p.left - p.right, h = m.clientHeight - p.top - p.bottom;
    const f = 1.5 * m.clientHeight, ra = Math.min(w, h) * .94 / 2, R = (ra * ra + ra * Math.sqrt(ra * ra + f * f)) / f;
    return clamp(Math.log2(R * Math.cos(HOME[1] * rad) / 81.49), .9, 3.4);
  }

  const easePads = () => map && map.easeTo({ padding: pads(), duration: reduced() ? 0 : 400 });
  const flyHome = () => { if (!map) return; stopSpin(); map.flyTo({ center: HOME, zoom: homeZoom(), padding: pads(), speed: .9, curve: 1.5 }); };
  const flyTo = h => map && map.flyTo({ center: [h.lon, h.lat], zoom: clamp(map.getZoom(), 4.2, 5.2), padding: pads(), speed: .9, curve: 1.5 });

  function graticule() {
    const line = c => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: c } });
    const f = [];
    for (let lon = -180; lon <= 180; lon += 15) f.push(line(Array.from({ length: 37 }, (_, i) => [lon, -90 + i * 5])));
    for (let lat = -75; lat <= 75; lat += 15) f.push(line(Array.from({ length: 73 }, (_, i) => [-180 + i * 5, lat])));
    return { type: 'FeatureCollection', features: f };
  }

  // every colour on the map is read from the CSS tokens, so night and day are one set of numbers in styles.css and this file writes none.
  // A hidden probe element carrying data-theme gives either theme's tokens, so the map holds both sets and flips between them without reloading tiles.
  const probes = {};
  const palette = theme => {
    const n = probes[theme] || (probes[theme] = Object.assign(document.createElement('i'), { hidden: true }));
    n.dataset.theme = theme; if (!n.isConnected) document.body.append(n);
    const v = k => getComputedStyle(n).getPropertyValue(k).trim();
    return {
      open: v('--open'), work: v('--work'), pend: v('--pending'), ok: v('--ok'), mark: v('--mark-line'), onStatus: v('--on-status'), ink: v('--ink'),
      ocean: v('--ocean'), land: v('--land'), grid: v('--grid'), gridA: +v('--grid-a'), none: v('--edge-none'), wash: v('--hover-wash'),
      ramp: [v('--ramp-0'), v('--ramp-1'), v('--ramp-2')], edge: [v('--edge-0'), v('--edge-1'), v('--edge-2')],
      sky: { 'sky-color': v('--sky'), 'horizon-color': v('--sky-h'), 'fog-color': v('--sky-f'), 'sky-horizon-blend': .5, 'horizon-fog-blend': .5, 'fog-ground-blend': .2, 'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 3, 1, 6, 0] },
    };
  };
  const HAS = ['boolean', ['feature-state', 'has'], false], PROG = ['coalesce', ['feature-state', 'p'], 0], IS_DAY = ['boolean', ['feature-state', 'day'], false];
  const landFill = P => ['case', HAS, ['interpolate', ['linear'], PROG, 0, P.ramp[0], .5, P.ramp[1], 1, P.ramp[2]], P.land];
  const edgeColor = P => ['case', HAS, ['interpolate', ['linear'], PROG, 0, P.edge[0], .5, P.edge[1], 1, P.edge[2]], P.none];
  // the country fill and edge hold both themes and a country's feature-state `day` picks one. Changing a data-driven paint expression instead makes MapLibre
  // re-parse every tile, which left patches of the old theme on screen for a second or two; changing feature states reloads nothing.
  const both = f => ['case', IS_DAY, f(palette('light')), f(palette('dark'))];
  const glowColor = P => ['match', ['get', 'st'], 'verified', P.ok, 'fixed', P.pend, 'assigned', P.work, P.open];   // status colours are the same in both themes
  // marker layers from the bottom of the stack to the top: status, fill, ring, glyph. A fixed marker is a ring round a dark disc, the ring colour being the status.
  const MARKERS = P => [['verified', P.ok, P.mark, 'ic-ok'], ['fixed', P.mark, P.pend, 'ic-wait'], ['assigned', P.work, P.mark, 'ic-asg'], ['open', P.open, P.mark, ''], ['reopened', P.open, P.mark, 'ic-re']];

  function baseStyle() {
    const P = palette(ui.theme);
    return {
      version: 8,
      projection: { type: 'globe' },
      sky: P.sky,
      sources: {
        countries: { type: 'geojson', data: window.MRS_COUNTRIES, promoteId: 'iso', tolerance: .35 },
        grid: { type: 'geojson', data: graticule() },
        hotspots: { type: 'geojson', data: EMPTY, promoteId: 'id' },
      },
      layers: [
        { id: 'ocean', type: 'background', paint: { 'background-color': P.ocean } },
        { id: 'grid', type: 'line', source: 'grid', paint: { 'line-color': P.grid, 'line-opacity': P.gridA, 'line-width': .6 } },
        { id: 'land', type: 'fill', source: 'countries', paint: { 'fill-color': both(landFill), 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 2.5, 1, 5, .6] } },
        { id: 'land-hover', type: 'fill', source: 'countries', paint: { 'fill-color': P.wash, 'fill-opacity': ['case', ['boolean', ['feature-state', 'hov'], false], .1, 0] } },
        { id: 'edges', type: 'line', source: 'countries', paint: {
          'line-color': both(edgeColor),
          'line-opacity': ['case', HAS, .85, .9],
          'line-width': ['case', ['boolean', ['feature-state', 'focus'], false], 2.6, HAS, 1.1, .5],
        } },
      ],
    };
  }

  const makeIcon = fn => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); g.lineCap = g.lineJoin = 'round'; fn(g); return g.getImageData(0, 0, 64, 64); };

  // the four glyphs on the markers, drawn again in the new colours when the theme changes
  const glyphs = P => ({
    'ic-ok': makeIcon(g => { g.strokeStyle = P.onStatus; g.lineWidth = 8; g.beginPath(); g.moveTo(19, 33); g.lineTo(28, 42); g.lineTo(45, 23); g.stroke(); }),
    'ic-re': makeIcon(g => { g.strokeStyle = P.onStatus; g.fillStyle = P.onStatus; g.lineWidth = 8; g.beginPath(); g.moveTo(32, 17); g.lineTo(32, 36); g.stroke(); g.beginPath(); g.arc(32, 47, 4.6, 0, 7); g.fill(); }),
    'ic-wait': makeIcon(g => { g.fillStyle = P.pend; g.beginPath(); g.moveTo(32, 32); g.lineTo(32, 15); g.arc(32, 32, 17, -Math.PI / 2, 0); g.closePath(); g.fill(); }),
    'ic-asg': makeIcon(g => { g.fillStyle = P.onStatus; g.beginPath(); g.arc(32, 32, 12, 0, 7); g.fill(); }),
  });
  let pulseColor = '';

  function addImages() {
    const P = palette(ui.theme); pulseColor = P.open;
    for (const [id, img] of Object.entries(glyphs(P))) map.addImage(id, img, { pixelRatio: 2 });
    // a ping that expands from unassigned critical plumes and reopened tickets: one image, redrawn by the map each frame
    const size = 128, cv = document.createElement('canvas'); cv.width = cv.height = size;
    const g = cv.getContext('2d', { willReadFrequently: true });
    map.addImage('pulse', {
      width: size, height: size, data: new Uint8Array(size * size * 4),
      render() {
        const t = calm() ? .45 : (performance.now() % 2400) / 2400, e = 1 - (1 - t) * (1 - t);
        g.clearRect(0, 0, size, size);
        g.beginPath(); g.arc(size / 2, size / 2, 16 + (size / 2 - 20) * e, 0, 7);
        g.lineWidth = 3; g.globalAlpha = (1 - t) * .85; g.strokeStyle = pulseColor; g.stroke();
        this.data = g.getImageData(0, 0, size, size).data;
        if (!calm()) map.triggerRepaint();
        return true;
      },
    }, { pixelRatio: 2 });
  }

  function addHotspotLayers() {
    // radius = k * a + b at zoom 0, k * c + d at zoom 6; k is the size from the emission rate
    const R = (a, b, c, d) => ['interpolate', ['linear'], ['zoom'], 0, ['+', ['*', ['get', 'k'], a], b], 6, ['+', ['*', ['get', 'k'], c], d]];
    const P = palette(ui.theme);
    const sort = { 'circle-sort-key': ['get', 'z'] };
    map.addLayer({ id: 'hs-glow', type: 'circle', source: 'hotspots', layout: sort, paint: { 'circle-radius': R(2.1, 0, 2.8, 0), 'circle-color': glowColor(P), 'circle-opacity': .17, 'circle-blur': 1 } });
    map.addLayer({ id: 'hs-pulse', type: 'symbol', source: 'hotspots', filter: ['==', ['get', 'pulse'], 1], layout: { 'icon-image': 'pulse', 'icon-size': ['interpolate', ['linear'], ['zoom'], 0, ['*', ['get', 'k'], .1], 6, ['*', ['get', 'k'], .19]], 'icon-allow-overlap': true, 'icon-ignore-placement': true } });
    // one marker layer and one glyph layer per status, stacked from verified up to reopened: a marker above covers the glyph of one below
    // instead of the glyph showing through it, which matters where plumes sit on top of each other
    const hov = ['boolean', ['feature-state', 'hov'], false];
    const iconSize = ['interpolate', ['linear'], ['zoom'], 0, ['*', ['get', 'k'], .0625], 6, ['*', ['get', 'k'], .119]];   // glyph canvas is 32px: scale it to the marker diameter
    for (const [st, fill, line, icon] of MARKERS(P)) {
      const only = ['==', ['get', 'st'], st];
      map.addLayer({ id: `hs-core-${st}`, type: 'circle', source: 'hotspots', filter: only, layout: sort, paint: { 'circle-radius': R(1, 0, 1.9, 0), 'circle-color': fill, 'circle-stroke-color': line, 'circle-stroke-width': ['case', hov, 3.5, st === 'fixed' ? 3 : 2] } });
      if (icon) map.addLayer({ id: `hs-icon-${st}`, type: 'symbol', source: 'hotspots', filter: only, layout: { 'icon-image': icon, 'icon-size': iconSize, 'icon-allow-overlap': true, 'icon-ignore-placement': true } });
    }
    map.addLayer({ id: 'hs-sel', type: 'circle', source: 'hotspots', paint: { 'circle-radius': R(1, 6, 1.9, 6), 'circle-opacity': 0, 'circle-stroke-color': P.ink, 'circle-stroke-width': 2.5, 'circle-stroke-opacity': ['case', ['boolean', ['feature-state', 'sel'], false], 1, 0] } });
    // invisible and generous: 36px across (44 for a finger), so small plumes are easy to hit
    const hit = matchMedia('(pointer: coarse)').matches ? 22 : 18;
    map.addLayer({ id: 'hs-hit', type: 'circle', source: 'hotspots', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 0, ['max', hit, ['get', 'k']], 6, ['max', hit, ['*', ['get', 'k'], 1.9]]], 'circle-opacity': 0 } });
  }

  function syncMap() {
    if (!mapReady) return;
    const features = H.map(h => {
      const t = stOf(h), k = sizeK(h), rank = t === 'verified' ? 1 : t === 'fixed' ? 2 : t === 'assigned' ? 3 : 4;   // the glow layer sorts by this; the marker layers are already stacked by status
      return {
        type: 'Feature', id: h.id, geometry: { type: 'Point', coordinates: [h.lon, h.lat] },
        properties: { id: h.id, k, z: rank * 100 - Math.min(h.rate / 1000, 99), st: t === 'new' ? 'open' : t, pulse: (t === 'new' && priOf(h) === 1) || t === 'reopened' ? 1 : 0 },
      };
    });
    map.getSource('hotspots').setData({ type: 'FeatureCollection', features });
    syncCountries();
    if (ui.sel) map.setFeatureState({ source: 'hotspots', id: ui.sel }, { sel: true });
  }

  const shown = new Map(), tokens = new Map();
  function syncCountries() {
    for (const c of countryStats().values()) {
      const from = shown.get(c.iso) ?? c.p;
      shown.set(c.iso, c.p);
      const id = { source: 'countries', id: c.iso }, tok = (tokens.get(c.iso) || 0) + 1;
      tokens.set(c.iso, tok);
      if (from === c.p || calm()) { map.setFeatureState(id, { has: true, p: c.p }); continue; }
      const t0 = performance.now();
      const step = t => {
        if (tokens.get(c.iso) !== tok) return;
        const k = clamp((t - t0) / 900, 0, 1), e = k * k * (3 - 2 * k);
        map.setFeatureState(id, { has: true, p: from + (c.p - from) * e });
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }
  }

  function syncSel(prev) {
    if (!mapReady) return;
    if (prev && prev !== ui.sel) map.setFeatureState({ source: 'hotspots', id: prev }, { sel: false });
    if (ui.sel) map.setFeatureState({ source: 'hotspots', id: ui.sel }, { sel: true });
  }

  // spin the globe slowly while motion is on. Touching the globe pauses motion, the same as the pause button, so the button always
  // shows what the globe is doing; an open ticket or country holds it still until it closes
  let spinning = false, spinRaf = 0, lastT = 0;
  // force: the viewer pressed play, which beats the open ticket or country that would otherwise keep the globe still
  function startSpin(force) {
    if (spinning || calm() || !mapReady || (!force && (ui.sel || ui.country))) return;
    spinning = true; lastT = performance.now(); spinRaf = requestAnimationFrame(spinStep);
  }
  function spinStep(t) { if (!spinning) return; const dt = Math.min(t - lastT, 50); lastT = t; const c = map.getCenter(); map.jumpTo({ center: [c.lng + dt * .0035, c.lat] }); spinRaf = requestAnimationFrame(spinStep); }
  function stopSpin() { spinning = false; cancelAnimationFrame(spinRaf); }

  // hover state shared by the map and the list
  let hovH = null, hovC = null;
  function setHover(id) {
    if (hovH === id) return;
    if (mapReady && hovH) map.setFeatureState({ source: 'hotspots', id: hovH }, { hov: false });
    hovH = id;
    if (mapReady && id) map.setFeatureState({ source: 'hotspots', id }, { hov: true });
  }

  function hoverHotspot(id, ev) {
    const h = HM.get(id); if (!h) return;
    setHover(id);
    const st = STATUS[stOf(h)];
    showTip(t => {
      t.append(el('b', '', `${h.country}, ${h.region}`), el('span', 't2', `${fmtRate(stOf(h) === 'verified' ? curRate(h) : h.rate)}, ${sec(h.sector).label}, P${priOf(h)}`));
      const r = el('span', 't3'); r.innerHTML = `<svg class="gl ${GROUP[st.group].cls}" aria-hidden="true"><use href="#${st.g}"/></svg>`; r.append(st.label); t.append(r);
    }, ev);
  }

  function hoverCountry(e) {
    if (map.queryRenderedFeatures(e.point, { layers: ['hs-hit'] }).length) return leaveCountry(true);
    const c = cStats.get(e.features?.[0]?.properties.iso);
    if (!c) return leaveCountry();
    if (hovC !== c.iso) { leaveCountry(true); hovC = c.iso; map.setFeatureState({ source: 'countries', id: c.iso }, { hov: true }); }
    map.getCanvas().style.cursor = 'pointer';
    showTip(t => t.append(el('b', '', c.name), el('span', 't2', `${pct(c.p)} of emissions verified fixed`), el('span', 't2', `${c.n} ${c.n === 1 ? 'ticket' : 'tickets'}, ${fmtRate(c.rem)} remaining`)), e.originalEvent);
  }
  function leaveCountry(keepTip) {
    if (hovC) map.setFeatureState({ source: 'countries', id: hovC }, { hov: false });
    hovC = null;
    if (!keepTip) { hideTip(); map.getCanvas().style.cursor = ''; }
  }

  // country names as HTML so they stay crisp and need no glyph server; hidden on the far side of the globe and when they collide
  let labels = [], labelRaf = 0;
  function buildLabels() {
    const box = $('#labels'); box.replaceChildren(); labels = [];
    for (const c of countryStats().values()) { const d = el('div', 'lab off'); d.append(el('span', '', c.name)); box.append(d); labels.push({ iso: c.iso, d, w: 0 }); }
    document.fonts?.ready.then(() => { labels.forEach(l => { l.w = l.d.firstChild.offsetWidth; }); updateLabels(); });
  }
  const angle = (a, b) => Math.acos(clamp(Math.sin(a.lat * rad) * Math.sin(b.lat * rad) + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos((a.lng - b.lon) * rad), -1, 1)) / rad;
  // the flat map repeats east and west, so project the copy of a place that sits nearest the view centre (the globe ignores this)
  const proj = h => map.project([h.lon + 360 * Math.round((map.getCenter().lng - h.lon) / 360), h.lat]);
  const onFarSide = h => { let g = 'globe'; try { g = map.getProjection().type; } catch (e) { /* older API */ } return g === 'globe' && angle(map.getCenter(), h) > (map.getZoom() < 3 ? 80 : 65); };

  function updateLabels() {
    if (!mapReady) return;
    const cv = map.getContainer(), W = cv.clientWidth, HH = cv.clientHeight, p0 = pads(), placed = [], z = map.getZoom();
    const selIso = ui.sel ? HM.get(ui.sel).iso : null;
    const cap = z < 2.2 ? 14 : z < 3 ? 22 : z < 3.8 ? 34 : 99;            // fewer names on the whole globe, more as you zoom in
    const zs = 1 + .9 * clamp(z / 6, 0, 1);                                 // markers grow with zoom; keep names below them
    const rank = L => (L.iso === selIso || L.iso === ui.country ? 1e12 : 0) + (cStats.get(L.iso)?.rem || 0);
    let shown = 0;
    for (const L of labels.slice().sort((a, b) => rank(b) - rank(a))) {
      const c = cStats.get(L.iso);
      let on = !!c && z >= 1.3 && shown < cap && !onFarSide(c) && !(L.iso === selIso && z >= 4);   // the open ticket already names its country
      if (on) {
        const p = proj(c), y = p.y + c.kmax * zs + 8;
        if (p.x < Math.max(24, p0.left - 40) || y < 20 || p.x > W - Math.max(24, p0.right - 40) || y > HH - 24) on = false;
        else {
          const w = (L.w || c.name.length * 6.6) + 10, r = { x: p.x - w / 2, y, w, h: 16 };
          if (placed.some(q => r.x < q.x + q.w && r.x + r.w > q.x && r.y < q.y + q.h && r.y + r.h > q.y)) on = false;
          else { placed.push(r); shown++; L.d.style.transform = `translate(${p.x.toFixed(1)}px, ${y.toFixed(1)}px)`; }
        }
      }
      L.d.classList.toggle('off', !on);
      L.d.classList.toggle('on', L.iso === ui.country || L.iso === selIso);
    }
  }
  const scheduleLabels = () => { if (!labelRaf) labelRaf = requestAnimationFrame(() => { labelRaf = 0; updateLabels(); }); };

  // a one-off ring where a plume has just flipped
  function burst(h, color) {
    if (!mapReady || calm() || onFarSide(h)) return;
    const p = proj(h), b = el('div', 'burst');
    b.style.cssText = `transform:translate(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px);--c:${color}`;
    $('#stage').append(b);
    setTimeout(() => b.remove(), 1400);
  }

  // the globe spins and critical plumes ping with no end, so there is a switch to stop all of it (it also follows prefers-reduced-motion)
  const PAUSE = '<path d="M8 5v14M16 5v14"/>', PLAY = '<path d="M8 5.5v13l10.5-6.5z"/>';
  // remember: false when a touch on the globe paused it, so an accidental touch is not kept for the next visit
  function setStill(v, remember = true) {
    ui.still = v;
    if (remember) try { localStorage.setItem('mrs:still', v ? '1' : '0'); } catch (e) { /* ignore */ }
    const b = $('.mctl');
    if (b) { b.setAttribute('aria-pressed', v); b.setAttribute('aria-label', v ? 'Resume motion' : 'Pause motion'); b.title = v ? 'Resume motion' : 'Pause motion'; b.firstChild.innerHTML = v ? PLAY : PAUSE; }
    if (v) stopSpin(); else startSpin(true);
    if (mapReady) map.triggerRepaint();
  }
  const motionCtl = {
    onAdd() {
      const d = el('div', 'maplibregl-ctrl maplibregl-ctrl-group'), b = el('button', 'mctl');
      b.type = 'button'; b.innerHTML = `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${PAUSE}</svg>`;
      b.addEventListener('click', () => setStill(!ui.still));
      d.append(b); this.d = d;
      queueMicrotask(() => setStill(ui.still));
      return d;
    },
    onRemove() { this.d.remove(); },
  };

  // globe / flat switch. The icon shows the view a click leads to: a flat map while on the globe, a sphere while flat
  const FLAT = '<rect x="3" y="6" width="18" height="12" rx="1.5"/><path d="M9 6v12M15 6v12M3 12h18"/>';
  const SPHERE = '<circle cx="12" cy="12" r="8.5"/><ellipse cx="12" cy="12" rx="3.6" ry="8.5"/><path d="M3.5 12h17"/>';
  const globeCtl = {
    onAdd(m) {
      const d = el('div', 'maplibregl-ctrl maplibregl-ctrl-group'), b = el('button', 'mctl');
      b.type = 'button';
      b.innerHTML = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"></svg>';
      const isGlobe = () => { try { return m.getProjection().type === 'globe'; } catch (e) { return true; } };   // not readable until the style loads; the map starts as a globe
      const sync = () => {
        const globe = isGlobe(), to = globe ? 'flat map' : 'globe';
        b.firstChild.innerHTML = globe ? FLAT : SPHERE;
        b.setAttribute('aria-label', `Switch to ${to}`); b.title = `Switch to ${to}`;
      };
      b.addEventListener('click', () => m.setProjection({ type: isGlobe() ? 'mercator' : 'globe' }));
      m.on('projectiontransition', sync); m.on('style.load', sync);
      d.append(b); this.d = d; sync();
      return d;
    },
    onRemove() { this.d.remove(); },
  };

  function initMap() {
    if (!window.maplibregl) return fallback();
    try {
      map = new maplibregl.Map({ container: 'map', style: baseStyle(), center: HOME, zoom: homeZoom(), minZoom: .8, maxZoom: 7.5, maxPitch: 0, dragRotate: false, attributionControl: false, renderWorldCopies: true, fadeDuration: 0, canvasContextAttributes: { antialias: true } });
    } catch (e) { map = null; return fallback(); }
    map.setPadding(pads());
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    map.addControl(globeCtl, 'bottom-right');
    map.addControl(motionCtl, 'bottom-right');
    map.on('load', onMapLoad);
    map.on('error', e => console.warn('map:', e && e.error && e.error.message));
  }
  function fallback() { const n = $('#nomap'); n.textContent = 'The map needs WebGL, which this browser has turned off. The ticket list and countries view still work.'; n.hidden = false; $('#map').classList.add('ready'); }

  function onMapLoad() {
    mapReady = true;
    addImages(); addHotspotLayers(); setDayStates();
    const cv = map.getCanvas();
    ['pointerdown', 'wheel', 'keydown'].forEach(ev => cv.addEventListener(ev, () => { if (!ui.still) setStill(true, false); }, { passive: true }));
    map.on('moveend', () => { if (!spinning) startSpin(); });   // closing a ticket or a country lets the globe spin again, if motion is on
    map.on('mousemove', 'hs-hit', e => { cv.style.cursor = 'pointer'; leaveCountry(true); hoverHotspot(e.features[0].properties.id, e.originalEvent); });
    map.on('mouseleave', 'hs-hit', () => { setHover(null); hideTip(); cv.style.cursor = ''; });
    map.on('click', 'hs-hit', e => select(e.features[0].properties.id, { focus: true }));
    map.on('mousemove', 'land', hoverCountry);
    map.on('mouseleave', 'land', () => leaveCountry());
    map.on('click', 'land', e => { if (!map.queryRenderedFeatures(e.point, { layers: ['hs-hit'] }).length) focusCountry(e.features[0]?.properties.iso); });
    map.on('move', scheduleLabels);
    map.on('movestart', hideTip);
    syncMap(); buildLabels(); updateLabels();
    $('#map').classList.add('ready'); $('#nomap').hidden = true;
    if (ui.sel) { syncSel(); flyTo(HM.get(ui.sel)); } else if (ui.country) focusCountry(ui.country); else startSpin();
  }

  // ---------- night and day ----------
  // the colours live in styles.css, so switching is one attribute on <html>; the map draws its own colours, so it is told to read them again
  // the country shapes pick their colours from the `day` feature state (see both()); every other colour here is a constant, which MapLibre repaints at once
  const setDayStates = () => { const day = ui.theme === 'light'; for (const f of window.MRS_COUNTRIES.features) map.setFeatureState({ source: 'countries', id: f.properties.iso }, { day }); };

  function applyMapTheme() {
    const P = palette(ui.theme); pulseColor = P.open;
    const paint = (id, prop, v) => map.setPaintProperty(id, prop, v);
    paint('ocean', 'background-color', P.ocean);
    paint('grid', 'line-color', P.grid); paint('grid', 'line-opacity', P.gridA);
    paint('land-hover', 'fill-color', P.wash);
    map.setSky(P.sky);
    paint('hs-sel', 'circle-stroke-color', P.ink);
    setDayStates();
    for (const [st, fill, line] of MARKERS(P)) { paint(`hs-core-${st}`, 'circle-color', fill); paint(`hs-core-${st}`, 'circle-stroke-color', line); }
    for (const [id, img] of Object.entries(glyphs(P))) map.updateImage(id, img);
    map.triggerRepaint();
  }

  function setTheme(t, remember = true) {
    ui.theme = t === 'light' ? 'light' : 'dark';
    const day = ui.theme === 'light';
    if (day) document.documentElement.dataset.theme = 'light'; else delete document.documentElement.dataset.theme;
    if (remember) try { localStorage.setItem('mrs:theme', ui.theme); } catch (e) { /* ignore */ }
    $('meta[name=color-scheme]').content = ui.theme; $('meta[name=theme-color]').content = css('--space');
    const b = $('#b-theme'), label = day ? 'Switch to night mode' : 'Switch to day mode';   // the button offers the other one
    b.setAttribute('aria-label', label); b.title = label; $('use', b).setAttribute('href', day ? '#i-moon' : '#i-sun');
    if (mapReady) applyMapTheme();
  }

  // ---------- events ----------
  function bind() {
    const list = $('#list');
    list.addEventListener('click', e => {
      if (e.target.closest('[data-act=clear]')) { Object.assign(ui, { status: 'all', sector: '', q: '' }); $('#q').value = ''; return clearCountry(false); }
      const b = e.target.closest('.row'); if (b) select(b.dataset.id, { focus: true });
    });
    list.addEventListener('mouseover', e => { const b = e.target.closest('.row'); if (b) setHover(b.dataset.id); });
    list.addEventListener('mouseleave', () => setHover(null));
    $('#foot').addEventListener('click', e => { if (e.target.closest('[data-act=clear]')) { Object.assign(ui, { status: 'all', sector: '', q: '' }); $('#q').value = ''; clearCountry(false); } });
    $('#clist').addEventListener('click', e => { const b = e.target.closest('.row'); if (b) focusCountry(b.dataset.iso); });
    // a party's row shows its tickets: the search already matches operators and assignees
    $('#plist').addEventListener('click', e => { const b = e.target.closest('[data-party]'); if (b) { ui.q = b.dataset.party; $('#q').value = ui.q; ui.status = 'all'; setTab('tickets'); renderQueue(); } });
    $('#b-export').addEventListener('click', exportCsv);
    $('#chips').addEventListener('click', e => { const b = e.target.closest('.chip'); if (b) { ui.status = b.dataset.s; renderQueue(); } });
    $('#f-sector').addEventListener('change', e => { ui.sector = e.target.value; renderQueue(); });
    $('#q').addEventListener('input', e => { ui.q = e.target.value; renderQueue(); });
    $('#scope').addEventListener('click', e => { if (e.target.closest('[data-act=unscope]')) clearCountry(); });
    $('.tabs').addEventListener('click', e => { const b = e.target.closest('[role=tab]'); if (b) setTab(b.dataset.tab); });
    $('.tabs').addEventListener('keydown', e => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const t = TABS[(TABS.indexOf(ui.tab) + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length]; setTab(t); $('#tab-' + t).focus();
    });
    $('#grab').addEventListener('click', () => setSheet(ui.sheet === 'min' ? 'mid' : 'min'));

    const dr = $('#drawer');
    dr.addEventListener('click', e => {
      const b = e.target.closest('[data-act]'), h = HM.get(ui.sel);
      if (!b || !h) return;
      const a = b.dataset.act;
      if (a === 'close') select(null);
      else if (a === 'dispatch') dispatch(h.id);
      else if (a === 'fix') logFix(h.id);
      else if (a === 'pass') advancePass();
    });
    dr.addEventListener('change', e => {
      const a = e.target.dataset.act, h = HM.get(ui.sel);
      if (!a || !h) return;
      if (a === 'pick') ui.draft.fixId = e.target.value;
      else if (a === 'assign') ui.draft.assignee = e.target.value;
      else if (a === 'pri') { T[h.id].priority = +e.target.value || null; save(); renderAll(); syncMap(); }
      else if (a === 'chk') { const r = ins(h), id = e.target.value; inspect(h.id, e.target.checked ? { done: [...r.done, id] } : { done: r.done.filter(x => x !== id), cause: r.cause === id ? '' : r.cause }); }
      else if (a === 'cause') inspect(h.id, { cause: e.target.value });
    });
    // typed fields are kept as they are typed, without redrawing the drawer (that would lose the caret)
    dr.addEventListener('input', e => {
      const a = e.target.dataset.act, h = HM.get(ui.sel);
      if (!h || (a !== 'note' && a !== 'sensor')) return;
      const v = e.target.value, n = parseFloat(v);
      inspect(h.id, a === 'note' ? { note: v.slice(0, 300) } : { sensor: Number.isFinite(n) && n >= 0 ? n : null }, { render: false });
    });
    const chartTip = e => {
      const c = e.target.closest?.('.hit'), h = HM.get(ui.sel);
      if (!c || !h) return;
      const p = passesOf(h)[+c.dataset.i], i = passInfo(h, p), r = c.getBoundingClientRect();
      showTip(t => t.append(el('b', '', `${i.date}: ${i.rate}`), el('span', 't2', i.change === '—' ? i.reading : `${i.change} vs baseline, ${i.reading.toLowerCase()}`)), e.clientX ? e : { clientX: r.left, clientY: r.top });
    };
    dr.addEventListener('mouseover', chartTip); dr.addEventListener('focusin', chartTip);
    dr.addEventListener('mouseout', e => { if (e.target.closest?.('.hit')) hideTip(); }); dr.addEventListener('focusout', e => { if (e.target.closest?.('.hit')) hideTip(); });

    $('#b-pass').addEventListener('click', () => advancePass());
    $('#b-theme').addEventListener('click', () => setTheme(ui.theme === 'light' ? 'dark' : 'light'));
    $('#b-reset').addEventListener('click', () => { if (confirm('Reset the demo? Every ticket goes back to its starting state.')) reset(); });

    addEventListener('keydown', e => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName);
      if (e.key === '/' && !typing) { e.preventDefault(); setTab('tickets'); $('#q').focus(); }
      else if (e.key === 'Escape') {
        if (e.target.id === 'q' && e.target.value) { e.target.value = ''; ui.q = ''; renderQueue(); }
        else if (ui.sel) select(null);
        else if (ui.country) clearCountry();
      } else if ((e.key === 'j' || e.key === 'k') && !typing && ui.tab === 'tickets') {
        const rows = visible().sort(byQueue), i = rows.findIndex(h => h.id === ui.sel), n = rows[clamp((i < 0 ? (e.key === 'j' ? 0 : rows.length - 1) : i + (e.key === 'j' ? 1 : -1)), 0, rows.length - 1)];
        if (n) { select(n.id); $(`.row[data-id="${n.id}"]`)?.focus({ preventScroll: true }); }
      }
    });
    mqWide.addEventListener('change', () => { PW = null; if (mapReady) { map.resize(); syncMap(); buildLabels(); easePads(); } });
    mqSlim.addEventListener('change', () => { PW = null; if (mapReady) easePads(); });
    addEventListener('resize', scheduleLabels);
  }

  function renderAll() { renderHeader(); renderCountries(); renderCompliance(); renderQueue(); renderDrawer(); if (mapReady) updateLabels(); }

  // where the incidents come from: MRS_API in config.js, or ?api=... on a local page only (a shared link must not be able to swap the data); empty means data.js
  function apiUrl() {
    const q = new URLSearchParams(location.search).get('api'), local = ['', 'localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
    return (local && q) || window.MRS_API || '';
  }

  async function boot() {
    if (!window.MRS_DATA) { $('#list').innerHTML = '<li class="empty"><p>No data loaded. data.js is missing or invalid.</p></li>'; return; }
    bind();
    const id = decodeURIComponent(location.hash.slice(1)), search = location.search;   // read before the first render rewrites the URL
    try { ui.still = localStorage.getItem('mrs:still') === '1'; } catch (e) { /* ignore */ }
    let data = window.MRS_DATA, failed = false;
    const api = apiUrl();
    if (api && window.MRS_FROM_API) {
      $('#list').innerHTML = '<li class="empty"><p>Loading incidents…</p></li>';
      try { data = await window.MRS_FROM_API(api, data.interventions); } catch (e) { console.warn('incident API:', e.message); failed = true; }
    }
    // data.js holds the offline copy of the database as raw API rows: adapt it the same way, so offline and live read alike
    if (data.rows && window.MRS_ADAPT) data = window.MRS_ADAPT(data.rows, data.interventions, { live: false, version: data.version });
    load(data);
    readUrl(search);
    if (HM.has(id)) ui.sel = id;
    renderAll();
    $('#b-tour').hidden = !window.MRS.tour;
    setTheme(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark', false);   // the head script already chose it; this syncs the button and the meta tags
    initMap();
    if (failed) toast('Could not reach the incident API, so this is the saved copy of the database.');
  }

  // runnable self-check of the ticket rules: run MRS.check() in the console. Throws on the first broken rule; resets the demo when done.
  function check() {
    const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: expected ${b}, got ${a}`); };
    const ok = (c, m) => { if (!c) throw new Error(m); };
    reset({ quiet: true });
    const [a, b] = H.filter(h => T[h.id].status === 'new' && !h.real).sort((x, y) => y.rate - x.rate);   // synthetic: the simulated pass leaves real detections alone
    const r = H.find(h => h.real && T[h.id].status === 'new');
    eq(kpis().n.ok, H.filter(h => h.seed?.status === 'verified').length, 'starting verified count');
    const db = H.find(h => T[h.id].status === 'assigned' && !T[h.id].assignedAt);
    if (db) ok(dueInfo(db).text.includes('from detection'), 'a ticket that arrives assigned with no date counts its deadline from detection');
    dispatch(a.id, null, null, { quiet: true }); eq(T[a.id].status, 'assigned', 'dispatch moves a ticket to assigned');
    eq(ins(a).cause, '', 'a new assignment starts a fresh inspection');
    const found = stepsOf(a)[1][0];
    inspect(a.id, { cause: found, sensor: 120 }, { render: false });
    ok(ins(a).done.includes(found), 'the step where the source was found counts as checked');
    logFix(a.id, { fate: 'ok', quiet: true }); eq(T[a.id].status, 'fixed', 'a logged fix waits for a satellite');
    ok(T[a.id].events.some(e => e.text.startsWith('Inspection on site')), 'the inspection result goes into the activity log');
    eq(remaining(a), a.rate, 'a fix no satellite has confirmed does not count');
    dispatch(b.id, null, null, { quiet: true }); logFix(b.id, { fate: 'fail', quiet: true });
    const realPasses = r ? passesOf(r).length : 0;
    advancePass({ noCloud: true });
    if (r) eq(passesOf(r).length, realPasses, 'a simulated pass adds no readings to a real detection');
    eq(T[a.id].status, 'verified', 'a fix that works is verified by the next pass');
    eq(T[b.id].status, 'reopened', 'a fix that fails reopens the ticket');
    ok(1 - curRate(a) / a.rate >= VERIFY, `verified means at least ${pct(VERIFY)} lower`);
    ok(avoided(a) > 0 && avoided(b) === 0, 'only verified reductions are counted as avoided');
    const c = countryStats().get(a.iso);
    ok(c.p > 0 && c.p <= 1, 'country progress is a share between 0 and 1');
    const ps = partyStats();
    eq(ps.reduce((n, p) => n + p.n, 0), H.length, 'every ticket sits in exactly one compliance row');
    eq(ps.reduce((n, p) => n + p.re, 0), H.filter(h => T[h.id].status === 'reopened').length, 'reopened tickets are counted against compliance');
    eq(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"', 'an exported cell cannot run as a spreadsheet formula');
    reset({ quiet: true });
    return 'MRS.check(): every rule holds';
  }

  // ---------- public API: tour.js and the data teammate use this ----------
  window.MRS = {
    check, load, select, dispatch, inspect, logFix, advancePass, reset, setTab, focusCountry, clearCountry, flyHome, stopSpin, toast, setTheme,
    get: () => ({ H, T, sim, ui, now: now(), priOf, stOf, curRate, options, stepsOf }),
    map: () => map,
  };
  document.addEventListener('DOMContentLoaded', boot);
})();

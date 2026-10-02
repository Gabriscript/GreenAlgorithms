/* Demo tour: a scripted walk through the product, written as the narration for the 2-minute video.
   It runs the real app (dispatch, fix, satellite pass) on a fresh demo state. Delete this file and its script tag to drop it:
   the "Play demo tour" button hides itself when MRS.tour is missing. */
(() => {
  'use strict';
  const M = window.MRS, $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const CO2E = 'CO<sub>2</sub>e';
  let token = 0, wake = null, skipped = false;

  // every wait ends early when the viewer presses Skip step
  const sleep = ms => new Promise(res => { if (skipped) return res(); const t = setTimeout(res, ms); wake = () => { clearTimeout(t); res(); }; });

  function spot(id) {
    document.querySelectorAll('.stg.spot').forEach(n => n.classList.remove('spot'));
    const s = id && document.getElementById(id)?.closest('.stg');
    if (!s) return;
    s.classList.add('spot');
    // scroll the drawer body only: scrollIntoView would also nudge the overflow:hidden panel around it
    const body = $('#d-body'), top = s.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop - 10;
    body.scrollTo({ top, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }

  // the biggest open plume, and the biggest one in another country: the first gets a fix that works, the second one that fails.
  // Synthetic tickets only: the tour invents fixes and satellite passes, which must never be shown on a real detection
  function pick() {
    const { H, T } = M.get();
    const open = H.filter(h => T[h.id].status === 'new' && !h.real).sort((a, b) => b.rate - a.rate);
    return { a: open[0], b: open.find(h => h.iso !== open[0].iso) || open[1] };
  }

  async function start() {
    const my = ++token;
    skipped = false; if (wake) wake();
    M.stopSpin(); M.reset({ quiet: true });
    const { a, b } = pick();
    if (!a || !b) return M.toast('The tour needs two tickets in Detected status.');
    const cut = h => Math.round((1 - M.get().curRate(h) / h.rate) * 100);
    // what each operator finds on site: a works (sensor agrees), b's sensor says fixed but the satellite will disagree
    const found = (h, k, sensorCut) => { const st = M.get().stepsOf(h), c = st[Math.min(k, st.length - 1)]; M.inspect(h.id, { done: st.map(x => x[0]), cause: c[0], note: `Repaired the ${c[1].toLowerCase()}`, sensor: Math.round(h.rate * (1 - sensorCut)) }); };

    const steps = [
      { say: () => 'Satellites spot methane plumes. Each one becomes a ticket, ranked by how much it matters.', hold: 6500 },
      { say: () => `The biggest open plume: ${Math.round(a.rate / 1000)} tonnes of methane an hour in ${esc(a.country)}. Open its ticket.`, go: () => M.select(a.id), hold: 7000 },
      { say: () => 'Source. The system names the likely emitter and says how sure it is.', go: () => spot('h-src'), hold: 6500 },
      { say: () => `Impact. What the plume does to the climate, in ${CO2E} and in cars.`, go: () => spot('h-imp'), hold: 6500 },
      { say: () => 'Action. Ranked fixes with cost and success rate. Assign the best one to the operator and the dot turns orange.',
        go: async () => { spot('h-act'); await sleep(3800); if (my !== token) return; M.dispatch(a.id, null, null, { quiet: true }); spot('h-act'); }, hold: 3600 },
      { say: () => 'Investigate. The operator works through an on-site checklist for this kind of site and records the broken component.',
        go: () => { found(a, 0, .9); spot('h-ins'); }, hold: 7000 },
      { say: () => 'The operator reports the fix, with a ground-sensor reading. The dot turns yellow, not green: nothing counts until a satellite confirms it.',
        go: () => { M.logFix(a.id, { fate: 'ok', quiet: true }); M.dispatch(b.id, null, null, { quiet: true }); found(b, 1, .88); M.logFix(b.id, { fate: 'fail', quiet: true }); spot('h-ver'); }, hold: 7500 },
      { say: () => 'Verify. The next satellite pass measures the plume again.',
        go: async () => { spot('h-ver'); await sleep(3200); if (my !== token) return; M.advancePass({ noCloud: true }); }, hold: 3800 },
      { say: () => `Confirmed: ${cut(a)}% lower. The dot turns green and ${esc(a.country)} shifts toward green.`, go: () => spot('h-ver'), hold: 7000 },
      { say: () => `Not every fix works. In ${esc(b.country)} the operator’s sensor said fixed, but the satellite saw the plume fall only ${cut(b)}%, so the ticket reopens.`, go: () => { M.select(b.id); spot('h-ver'); }, hold: 8000 },
      { say: () => 'Zoom out. Each country shows the share of its emissions that satellites have verified as fixed.', go: () => { M.select(null); M.setTab('countries'); M.flyHome(); }, hold: 7000 },
      { say: () => 'Compliance. Overdue and reopened tickets per operator, and the full evidence trail ready to download for an audit.', go: () => M.setTab('compliance'), hold: 7000 },
      { say: () => 'Detect, attribute, fix, verify. One loop for every plume.', hold: 5500 },
    ];

    document.body.classList.add('touring');
    $('#tour').hidden = false;
    $('#t-exit').focus({ preventScroll: true });   // the page behind is locked while touring: keep keyboard focus on a way out
    $('#t-dots').innerHTML = steps.map(() => '<i></i>').join('');
    for (let i = 0; i < steps.length; i++) {
      if (my !== token) return;
      skipped = false;
      [...$('#t-dots').children].forEach((d, k) => { d.className = k < i ? 'on' : k === i ? 'cur' : ''; });
      $('#t-text').innerHTML = steps[i].say();
      if (steps[i].go) await steps[i].go();
      if (my !== token) return;
      await sleep(steps[i].hold);
    }
    if (my !== token) return;
    exit();
    M.toast('Tour finished. Playing it again starts from a fresh demo.');
  }

  function exit() {
    token++; skipped = true; if (wake) wake();
    if ($('#tour').contains(document.activeElement)) $('#b-tour').focus({ preventScroll: true });
    $('#tour').hidden = true;
    document.body.classList.remove('touring');
    spot(null);
  }

  $('#b-tour').addEventListener('click', start);
  $('#t-skip').addEventListener('click', () => { skipped = true; if (wake) wake(); });
  $('#t-exit').addEventListener('click', exit);
  addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#tour').hidden) { e.stopImmediatePropagation(); exit(); } }, true);
  M.tour = { start, exit };
})();

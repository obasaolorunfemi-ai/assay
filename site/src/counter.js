/* The live counter on the home page: totals that apps taking part have reported. It asks this site's own /api/count, shows what it gets, and asks again every
   30 seconds while the page is open and visible. If the counter cannot be reached the numbers stay as dashes and nothing else on the page changes. */
(() => {
  const box = document.getElementById('live');
  if (!box) return;
  const note = document.getElementById('live-note');
  const nf = new Intl.NumberFormat();
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const shown = {};
  const draw = (el, to) => {
    const from = shown[el.dataset.k] ?? 0;
    shown[el.dataset.k] = to;
    if (calm || from === to) { el.textContent = nf.format(to); return; }
    const t0 = performance.now();
    const step = (t) => { const k = Math.min(1, (t - t0) / 700); el.textContent = nf.format(Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3)))); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  };
  const load = async () => {
    try {
      const r = await fetch('/api/count', { cache: 'no-store', headers: { accept: 'application/json' } });
      if (!r.ok) throw new Error(String(r.status));
      const d = await r.json();
      for (const el of box.querySelectorAll('[data-k]')) draw(el, Number(d[el.dataset.k]) || 0);
      if (note) note.textContent = d.reports ? `Counting since ${d.since}. Last report ${new Date(d.updated).toLocaleString()}.` : 'No app has reported yet. The first report will appear here.';
    } catch (e) {
      if (note) note.textContent = 'The counter cannot be reached just now. It will try again.';
    }
  };
  load();
  setInterval(() => { if (!document.hidden) load(); }, 30000);
})();

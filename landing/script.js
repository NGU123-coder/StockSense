// StockSense landing page — vanilla JavaScript, no libraries.
// 1. A live reorder-point calculator using the same formulas as the forecasting service.
// 2. App links that point at the deployed app when APP_URL is set.

(function () {
  'use strict';

  // Set this to your deployed frontend, e.g. 'https://stocksense.vercel.app'.
  const APP_URL = window.STOCKSENSE_APP_URL || 'http://localhost:5173';
  document.querySelectorAll('[data-app-link]').forEach((a) => (a.href = APP_URL));

  const form = document.getElementById('calc-form');
  if (!form) return;

  const $ = (id) => document.getElementById(id);
  const fmt = (n) => Math.round(n).toLocaleString('en-IN');
  const num = (name, min = 0) => Math.max(min, Number(form.elements[name].value) || 0);

  function update() {
    const daily = num('daily');
    const sigma = num('sigma');
    const lead = num('lead', 1);
    const onHand = num('onhand');
    const z = Number(form.elements.service.value);

    // Safety stock covers demand variation during the lead time.
    const safety = z * sigma * Math.sqrt(lead);
    // Reorder when stock can no longer cover the lead time plus the safety buffer.
    const rop = daily * lead + safety;
    // Order enough for the lead time + 14 days, plus safety stock, minus what we have.
    const orderQty = Math.max(0, Math.ceil(daily * (lead + 14) + safety - onHand));
    const cover = daily > 0 ? onHand / daily : Infinity;

    $('out-safety').textContent = fmt(safety);
    $('out-rop').textContent = fmt(rop);
    $('out-cover').textContent = !isFinite(cover) ? 'Never' : cover < 1 ? '< 1 day' : `${Math.floor(cover)} days`;

    const verdict = $('out-verdict');
    verdict.className = 'calc__verdict';
    if (onHand === 0) {
      verdict.classList.add('is-out');
      verdict.textContent = `Out of stock. Order ${fmt(orderQty)} units today and expect ${lead} days without sales.`;
    } else if (onHand <= rop) {
      verdict.classList.add('is-order');
      verdict.textContent =
        cover < lead
          ? `Order ${fmt(orderQty)} units now. Stock runs out in ${Math.floor(cover)} days, before a new delivery can arrive.`
          : `Order ${fmt(orderQty)} units now to stay ahead of the ${lead}-day lead time.`;
    } else {
      verdict.classList.add('is-ok');
      verdict.textContent = `No order needed yet. Reorder when stock falls to ${fmt(rop)}, in about ${Math.max(0, Math.floor((onHand - rop) / (daily || 1)))} days.`;
    }

    $('out-formula').textContent =
      `Safety stock = ${z} × ${sigma} × √${lead}. Reorder point = ${fmt(daily)} × ${lead} days + safety stock.`;

    // Runway: same visual as the app. Reorder point sits near 40% unless stock is far above it.
    const max = Math.max(onHand * 1.08, rop * 2.5, 1);
    const pct = (v) => `${Math.min(100, (v / max) * 100)}%`;
    const fill = $('rw-fill');
    fill.style.width = onHand === 0 ? '4px' : pct(onHand);
    fill.style.backgroundColor = onHand === 0 ? 'var(--out)' : onHand <= rop ? 'var(--signal)' : 'var(--stock)';
    $('rw-safety').style.width = pct(safety);
    $('rw-tick').style.left = pct(rop);
    $('rw-tick-label').textContent = `Reorder at ${fmt(rop)}`;
  }

  form.addEventListener('input', update);
  form.addEventListener('submit', (e) => e.preventDefault());
  update();
})();

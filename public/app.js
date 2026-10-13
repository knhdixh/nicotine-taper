import { buildPlan, currentStepIndex, addDays, DEFAULTS, DEVICES, PACES, InputError } from '/taper.js';

const $form = document.getElementById('form');
const $result = document.getElementById('result');
const $toast = document.getElementById('toast');
const $tip = document.getElementById('tip');
const STORE_KEY = 'nicotine-taper:v1';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

let toastTimer;
export function toast(msg, isError = false) {
  $toast.textContent = msg;
  $toast.className = 'toast' + (isError ? ' error' : '');
  $toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($toast.hidden = true), isError ? 6000 : 3000);
}

// ---------- inputs ----------

// Fields that appear in the URL and local storage. reductionPct is the form's view of `reduction`.
const FIELDS = ['cigsPerDay', 'device', 'pace', 'startDate', 'mgPerCig', 'maxStrength', 'startStrength', 'switchWeeks', 'reductionPct', 'stepDays', 'zeroWeeks'];

document.getElementById('devices').innerHTML = Object.entries(DEVICES).map(([k, d]) => `
  <label class="choice"><input type="radio" name="device" value="${k}">
    <span><b>${esc(d.label.split(' (')[0])}</b><small class="muted">${esc(d.label.match(/\((.*)\)/)?.[1] ?? '')} · usually ${d.strengths.at(-1)}–${d.strengths[0]} mg/mL</small></span>
  </label>`).join('');
document.getElementById('paces').innerHTML = Object.entries(PACES).map(([k, p]) => `
  <label><input type="radio" name="pace" value="${k}"><span>${esc(p.label.split(':')[0])}<small>${esc(p.label.split(': ')[1])}</small></span></label>`).join('');

function defaultsForForm() {
  return { ...DEFAULTS, reductionPct: '', startStrength: '', stepDays: '', startDate: '' };
}

function readForm() {
  const fd = new FormData($form);
  const v = {};
  for (const k of FIELDS) v[k] = (fd.get(k) ?? '').toString().trim();
  return v;
}

function writeForm(v) {
  for (const k of FIELDS) {
    const el = $form.elements[k];
    if (!el) continue;
    if (el instanceof RadioNodeList) {
      for (const r of el) r.checked = r.value === String(v[k]);
    } else el.value = v[k] ?? '';
  }
  $form.elements.cigsRange.value = Math.min(60, Number(v.cigsPerDay) || 20);
}

function toInput(v) {
  const input = { ...v, reduction: v.reductionPct === '' ? null : Number(v.reductionPct) / 100 };
  delete input.reductionPct;
  if (input.stepDays !== '' && input.stepDays != null) input.stepDays = Number(input.stepDays);
  return input;
}

function loadInitial() {
  const base = defaultsForForm();
  const q = new URLSearchParams(location.search);
  if (FIELDS.some((k) => q.has(k))) {
    for (const k of FIELDS) if (q.has(k)) base[k] = q.get(k);
    return base;
  }
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (saved) for (const k of FIELDS) if (k in saved) base[k] = saved[k];
  } catch { /* storage unavailable */ }
  return base;
}

function shareUrl(v) {
  const q = new URLSearchParams();
  const d = defaultsForForm();
  for (const k of FIELDS) if (v[k] !== '' && String(v[k]) !== String(d[k])) q.set(k, v[k]);
  return location.origin + location.pathname + (q.size ? '?' + q : '');
}

// ---------- rendering ----------

const fmt = (n, d = 1) => (Math.round(n * 10 ** d) / 10 ** d).toLocaleString(undefined, { maximumFractionDigits: d });
const dateFmt = (iso) => new Date(iso + 'T00:00:00Z').toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
const todayIso = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const PHASE = { switch: 'Switch', taper: 'Step down', zero: '0 mg' };

function weekLabel(st) {
  const a = st.startDay / 7 + 1, b = (st.startDay + st.days) / 7;
  return a === b ? `Week ${a}` : Number.isInteger(a) && Number.isInteger(b) ? `Weeks ${a}–${b}` : `Days ${st.startDay + 1}–${st.startDay + st.days}`;
}

function liquidCell(st, plan) {
  if (st.strength === 0) return '<b>0 mg/mL</b><small class="muted">nicotine-free</small>';
  const shop = st.shopStrength === st.strength ? 'sold as is' : `nearest in shops: ${fmt(st.shopStrength)}`;
  const mix = st.mix ? `<small class="muted">or mix ${fmt(st.mix.nicLiquid)} mL of ${fmt(plan.startStrength)} mg + ${fmt(st.mix.zeroLiquid)} mL of 0 mg</small>` : '';
  return `<b>${fmt(st.strength)} mg/mL</b><small class="muted">${shop}</small>${mix}`;
}

function todayCard(plan, idx) {
  if (idx == null) return '';
  if (idx === -1) return `<div class="today"><span class="eyebrow">Before you start</span><p>Your plan starts on <b>${dateFmt(plan.input.startDate)}</b>. Get a device and ${fmt(plan.startStrength)} mg/mL liquid ready.</p></div>`;
  if (idx >= plan.steps.length) return `<div class="today done"><span class="eyebrow">Plan complete</span><p>You finished the plan on <b>${dateFmt(plan.endDate)}</b>. Well done. If you're still vaping 0 mg, you can put the device down whenever you're ready.</p></div>`;
  const st = plan.steps[idx];
  const left = st.startDay + st.days - Math.round((Date.parse(todayIso()) - Date.parse(plan.input.startDate)) / 86400000);
  const what = st.phase === 'switch'
    ? `Smoke at most <b>${st.cigs}</b> cigarettes a day and vape about <b>${fmt(st.volume)} mL</b> of ${fmt(st.strength)} mg/mL.`
    : st.phase === 'zero'
      ? `Vape 0 mg/mL liquid when you want to. Your body is already nicotine-free; this is just the habit.`
      : `No cigarettes. Vape about <b>${fmt(st.volume)} mL</b> a day of <b>${fmt(st.strength)} mg/mL</b>.`;
  return `<div class="today"><span class="eyebrow">Today · step ${st.index} of ${plan.steps.length} · ${left} day${left === 1 ? '' : 's'} left in this step</span><p>${what}</p></div>`;
}

function chart(plan, idx) {
  // Draw at the real pixel width so axis text stays legible on phones.
  const W = Math.max(280, Math.min(900, ($result.clientWidth || 640) - 40));
  const H = W < 500 ? 200 : 240, L = 30, R = 6, T = 12, B = 26;
  const total = plan.totalDays;
  const ymax = Math.max(...plan.steps.map((s) => s.nicotine)) * 1.1 || 1;
  const tickStep = [1, 2, 5, 10, 20].find((t) => ymax / t <= 5) ?? 20;
  const x = (d) => L + (d / total) * (W - L - R);
  const y = (v) => T + (1 - v / ymax) * (H - T - B);
  let g = '';
  for (let t = 0; t <= ymax; t += tickStep) {
    g += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text class="axis" x="${L - 6}" y="${y(t) + 4}" text-anchor="end">${t}</text>`;
  }
  const perTick = W < 500 ? 70 : 60; // px per x label
  const weekTick = [1, 2, 4, 8, 13, 26].find((t) => (x(t * 7) - x(0)) >= perTick) ?? 52;
  for (let w = 0; w * 7 <= total && x(w * 7) <= W - R - 22; w += weekTick) g += `<text class="axis" x="${x(w * 7)}" y="${H - 8}" text-anchor="middle">${w ? 'wk ' + w : 'start'}</text>`;
  let bars = '';
  plan.steps.forEach((st, i) => {
    const x0 = x(st.startDay) + 1, w = Math.max(1, x(st.startDay + st.days) - x(st.startDay) - 2);
    const cigNic = st.cigs * plan.input.mgPerCig, vapeNic = Math.max(0, st.nicotine - cigNic);
    const yv = y(vapeNic), yc = y(vapeNic + cigNic);
    const r = Math.min(4, w / 2);
    const top = (yTop, cls, h) => h > 0 ? `<path class="${cls}" d="M${x0},${yTop + h} V${yTop + r} q0,-${r} ${r},-${r} h${w - 2 * r} q${r},0 ${r},${r} V${yTop + h} Z"/>` : '';
    let marks = '';
    if (cigNic > 0) {
      marks += `<rect class="vape" x="${x0}" y="${yv}" width="${w}" height="${y(0) - yv}"/>`;
      marks += top(yc, 'cig', Math.max(0, yv - yc - 2));
    } else if (vapeNic > 0) {
      marks += top(yv, 'vape', y(0) - yv);
    } else {
      marks += `<rect class="zero" x="${x0}" y="${y(0) - 2}" width="${w}" height="2"/>`;
    }
    bars += `<g class="bar${i === idx ? ' now' : ''}" data-i="${i}"><rect class="hit" x="${x0 - 1}" y="${T}" width="${w + 2}" height="${H - T - B}"/>${marks}</g>`;
  });
  return `<figure class="chart">
    <figcaption><span>Estimated nicotine per day (mg)</span>
      <span class="legend"><i class="sw cig"></i>Cigarettes <i class="sw vape"></i>Vaping</span></figcaption>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Nicotine per day falls from ${plan.dailyNicotine} mg to 0 over ${plan.totalWeeks} weeks">${g}${bars}
      <line class="baseline" x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}"/></svg>
  </figure>`;
}

function render(plan) {
  const idx = currentStepIndex(plan, todayIso());
  const firstFull = plan.steps.find((s) => s.phase === 'taper');
  const end = plan.endDate ? dateFmt(plan.endDate) : `${fmt(plan.totalWeeks)} weeks`;
  $result.innerHTML = `
    ${plan.warnings.map((w) => `<div class="note warn" role="note"><b>Heads up.</b> ${esc(w)}</div>`).join('')}
    ${todayCard(plan, idx)}
    <div class="tiles">
      <div class="tile"><span class="label">Nicotine now</span><span class="value">${fmt(plan.dailyNicotine)}<small> mg/day</small></span><span class="muted small">from ${plan.input.cigsPerDay} cigarettes</span></div>
      <div class="tile"><span class="label">Start liquid</span><span class="value">${fmt(plan.startStrength)}<small> mg/mL</small></span><span class="muted small">${plan.startStrength === plan.autoStartStrength ? 'suggested for you' : 'your choice'}</span></div>
      <div class="tile"><span class="label">Vape per day</span><span class="value">≈${fmt(firstFull.volume)}<small> mL</small></span><span class="muted small">held steady the whole way</span></div>
      <div class="tile"><span class="label">Nicotine-free</span><span class="value">${plan.endDate ? end : fmt(plan.totalWeeks) + '<small> weeks</small>'}</span><span class="muted small">${plan.steps.length} steps</span></div>
    </div>
    <div class="panel">${chart(plan, idx)}</div>
    <div class="panel steps-panel">
      <h2>Week by week</h2>
      <table class="steps">
        <thead><tr><th>When</th><th>Phase</th><th>Cigarettes/day</th><th>E-liquid</th><th>Vape/day</th><th>Nicotine/day</th></tr></thead>
        <tbody>${plan.steps.map((st, i) => `
          <tr class="${i === idx ? 'now' : ''} ${st.phase}">
            <td data-k="When"><b>${weekLabel(st)}</b>${st.startDate ? `<small class="muted">${dateFmt(st.startDate)} – ${dateFmt(addDays(st.startDate, st.days - 1))}</small>` : ''}</td>
            <td data-k="Phase"><span class="pill ${st.phase}">${PHASE[st.phase]}</span></td>
            <td data-k="Cigarettes/day">${st.cigs ? `<b>${st.cigs}</b>` : '<span class="muted">0</span>'}</td>
            <td data-k="E-liquid">${liquidCell(st, plan)}</td>
            <td data-k="Vape/day" class="nowrap">≈${fmt(st.volume)} mL</td>
            <td data-k="Nicotine/day"><b>${fmt(st.nicotine)} mg</b><small class="muted">${st.pctOfStart}% of now</small></td>
          </tr>`).join('')}
        </tbody>
      </table>
      <p class="muted small">Vape amounts assume ${esc(plan.device.label.toLowerCase())}, absorbing about ${Math.round(plan.device.absorption * 100)}% of the nicotine in the liquid.
        Mix recipes make 10 mL; scale as needed.</p>
    </div>`;
  bindTips(plan);
}

function bindTips(plan) {
  const svg = $result.querySelector('.chart svg');
  if (!svg) return;
  const show = (e) => {
    const g = e.target.closest('.bar');
    if (!g) return hide();
    const st = plan.steps[Number(g.dataset.i)];
    $tip.innerHTML = `<b>${weekLabel(st)}</b> · ${PHASE[st.phase]}<br>${st.cigs ? `${st.cigs} cigarettes + ` : ''}${st.strength ? `${fmt(st.volume)} mL of ${fmt(st.strength)} mg/mL` : '0 mg/mL'}<br><b>${fmt(st.nicotine)} mg</b> nicotine/day`;
    $tip.hidden = false;
    const px = e.clientX ?? 0, py = e.clientY ?? 0;
    const w = $tip.offsetWidth;
    $tip.style.left = Math.min(window.innerWidth - w - 8, Math.max(8, px - w / 2)) + 'px';
    $tip.style.top = Math.max(8, py - $tip.offsetHeight - 14) + 'px';
  };
  const hide = () => ($tip.hidden = true);
  svg.addEventListener('pointermove', show);
  svg.addEventListener('pointerdown', show);
  svg.addEventListener('pointerleave', hide);
}

// ---------- wiring ----------

function update() {
  const v = readForm();
  try { localStorage.setItem(STORE_KEY, JSON.stringify(v)); } catch { /* storage unavailable */ }
  try {
    render(buildPlan(toInput(v)));
  } catch (e) {
    if (!(e instanceof InputError)) throw e;
    $result.querySelector('.note.error')?.remove();
    $result.insertAdjacentHTML('afterbegin', `<div class="note error" role="alert">${esc(e.message)}</div>`);
  }
}

$form.addEventListener('input', (e) => {
  if (e.target.name === 'cigsRange') $form.elements.cigsPerDay.value = e.target.value;
  if (e.target.name === 'cigsPerDay' && e.target.value) $form.elements.cigsRange.value = Math.min(60, e.target.value);
  update();
});
$form.addEventListener('submit', (e) => e.preventDefault());

document.getElementById('share').addEventListener('click', async () => {
  const url = shareUrl(readForm());
  history.replaceState(null, '', url);
  try { await navigator.clipboard.writeText(url); toast('Link copied. It opens this exact plan.'); }
  catch { toast('Link is in the address bar.'); }
});
document.getElementById('print').addEventListener('click', () => window.print());
document.getElementById('reset').addEventListener('click', () => {
  history.replaceState(null, '', location.pathname);
  writeForm(defaultsForForm());
  update();
});

let lastWidth = 0;
new ResizeObserver(() => {
  const w = $result.clientWidth;
  if (Math.abs(w - lastWidth) > 30) { lastWidth = w; update(); }
}).observe($result);

writeForm(loadInitial());
update();

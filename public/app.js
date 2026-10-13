import { buildPlan, currentStepIndex, addDays, DEFAULTS, LADDER, PACES, InputError } from '/taper.js';

const $form = document.getElementById('form');
const $result = document.getElementById('result');
const $toast = document.getElementById('toast');
const STORE_KEY = 'nicotine-taper:v2';
const FIELDS = ['cigsPerDay', 'pace', 'startDate'];

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

let toastTimer;
export function toast(msg, isError = false) {
  $toast.textContent = msg;
  $toast.className = 'toast' + (isError ? ' error' : '');
  $toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($toast.hidden = true), isError ? 6000 : 3000);
}

const todayIso = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const dateFmt = (iso) => new Date(iso + 'T00:00:00Z').toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
const longDate = (iso) => new Date(iso + 'T00:00:00Z').toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

document.getElementById('paces').innerHTML = Object.entries(PACES).map(([k, p]) => `
  <label><input type="radio" name="pace" value="${k}"><span>${p.label}<small>${p.weeks} weeks per step</small></span></label>`).join('');

// ---------- form state ----------

function readForm() {
  const fd = new FormData($form);
  return Object.fromEntries(FIELDS.map((k) => [k, (fd.get(k) ?? '').toString().trim()]));
}

function writeForm(v) {
  $form.elements.cigsPerDay.value = v.cigsPerDay;
  $form.elements.cigsRange.value = Math.min(40, Number(v.cigsPerDay) || 20);
  for (const r of $form.elements.pace) r.checked = r.value === v.pace;
  $form.elements.startDate.value = v.startDate || '';
}

function loadInitial() {
  const base = { ...DEFAULTS, startDate: todayIso() };
  const q = new URLSearchParams(location.search);
  if (FIELDS.some((k) => q.has(k))) {
    for (const k of FIELDS) if (q.has(k)) base[k] = q.get(k);
    return base;
  }
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (saved) for (const k of FIELDS) if (saved[k]) base[k] = saved[k];
  } catch { /* storage unavailable */ }
  return base;
}

function packsText(n) {
  if (!n) return '';
  if (n === 20) return 'One pack a day.';
  if (n === 10) return 'Half a pack a day.';
  if (n < 20) return `About ${Math.round((n / 20) * 10) / 10} of a pack a day.`;
  return `About ${Math.round((n / 20) * 10) / 10} packs a day.`;
}

// ---------- rendering ----------

function instruction(st, plan, i) {
  if (i === 0) return `<b>Stop cigarettes.</b> Vape ${st.strength} mg whenever you'd have smoked.`;
  if (st.strength === 0) return `<b>Switch to 0 mg.</b> Same habit, no nicotine. Stop vaping whenever you're ready.`;
  return `<b>Switch to ${st.strength} mg.</b> Vape as usual, no more than before.`;
}

function when(st) {
  const weeks = st.startWeek === st.endWeek ? `Week ${st.startWeek}` : `Weeks ${st.startWeek}–${st.endWeek}`;
  return st.startDate ? `<b>${dateFmt(st.startDate)} – ${dateFmt(st.endDate)}</b><span class="muted">${weeks}</span>` : `<b>${weeks}</b>`;
}

function hero(plan, idx) {
  if (idx == null || idx < 0) {
    const start = plan.input.startDate ? ` on <b>${longDate(plan.input.startDate)}</b>` : '';
    return `<div class="hero"><span class="eyebrow">Your plan</span>
      <div class="hero-row"><div class="big">${plan.startStrength}<small>mg</small></div>
      <p>Start${start} with <b>${plan.startStrength} mg</b> e-liquid instead of cigarettes.<br>
      <span class="muted">Nicotine-free in ${plan.totalWeeks} weeks${plan.endDate ? `, by ${longDate(plan.endDate)}` : ''}.</span></p></div></div>`;
  }
  if (idx >= plan.steps.length) {
    return `<div class="hero done"><span class="eyebrow">Plan complete</span><p>You've been nicotine-free since ${longDate(plan.steps.at(-1).startDate)}. Well done!</p></div>`;
  }
  const st = plan.steps[idx];
  const daysLeft = st.startDay + st.days - Math.round((Date.parse(todayIso()) - Date.parse(plan.input.startDate)) / 86400000);
  const next = plan.steps[idx + 1];
  return `<div class="hero"><span class="eyebrow">Right now · step ${idx + 1} of ${plan.steps.length}</span>
    <div class="hero-row"><div class="big">${st.strength}<small>mg</small></div>
    <p>${instruction(st, plan, idx)}<br><span class="muted">${next
      ? `${plural(daysLeft, 'day')} until you switch to ${next.strength} mg.`
      : `${plural(daysLeft, 'day')} until you're done.`}</span></p></div></div>`;
}

function render(plan) {
  const idx = currentStepIndex(plan, todayIso());
  $result.innerHTML = `
    ${hero(plan, idx)}
    <div class="panel">
      <div class="plan-head">
        <h2>Your steps</h2>
        <div class="actions">
          <button type="button" class="btn" id="share">Copy link</button>
          <button type="button" class="btn" id="print">Print</button>
        </div>
      </div>
      <ol class="ladder">
        ${plan.steps.map((st, i) => `
          <li class="${[i === idx && 'now', idx != null && i < idx && 'past', st.strength === 0 && 'zero'].filter(Boolean).join(' ')}">
            <span class="dot" aria-hidden="true"></span>
            <div class="when">${when(st)}${i === idx ? ' <span class="you">You are here</span>' : ''}</div>
            <div class="dose"><span class="mg">${st.strength}<small> mg</small></span>
              <span class="bar" aria-hidden="true"><i style="width:${Math.max(3, (st.strength / LADDER[0]) * 100)}%"></i></span></div>
            <p class="what">${instruction(st, plan, i)}</p>
          </li>`).join('')}
        <li class="finish${idx === plan.steps.length ? ' now' : ''}">
          <span class="dot" aria-hidden="true"></span>
          <div class="when">${plan.endDate ? `<b>From ${dateFmt(addDays(plan.endDate, 1))}</b>` : `<b>After week ${plan.totalWeeks}</b>`}</div>
          <p class="what"><b>Nicotine-free.</b> 🎉</p>
        </li>
      </ol>
      <p class="muted small">Your ${plural(plan.input.cigsPerDay, 'French cigarette')} a day give about ${plan.nicotinePerDay} mg of nicotine.
        ${plan.startStrength} mg e-liquid is the usual match for that, so you shouldn't feel a drop when you switch.</p>
    </div>`;
  document.getElementById('share').onclick = share;
  document.getElementById('print').onclick = () => window.print();
}

async function share() {
  const q = new URLSearchParams(Object.entries(readForm()).filter(([, x]) => x));
  const url = location.origin + location.pathname + '?' + q;
  history.replaceState(null, '', url);
  try { await navigator.clipboard.writeText(url); toast('Link copied. It opens this exact plan.'); }
  catch { toast('Link is in the address bar.'); }
}

function update() {
  const v = readForm();
  document.getElementById('packs').textContent = packsText(Number(v.cigsPerDay));
  try { localStorage.setItem(STORE_KEY, JSON.stringify(v)); } catch { /* storage unavailable */ }
  try {
    render(buildPlan(v));
  } catch (e) {
    if (!(e instanceof InputError)) throw e;
    $result.querySelector('.note.error')?.remove();
    $result.insertAdjacentHTML('afterbegin', `<div class="note error" role="alert">${esc(e.message)}</div>`);
  }
}

$form.addEventListener('input', (e) => {
  if (e.target.name === 'cigsRange') $form.elements.cigsPerDay.value = e.target.value;
  if (e.target.name === 'cigsPerDay' && e.target.value) $form.elements.cigsRange.value = Math.min(40, e.target.value);
  update();
});
$form.addEventListener('submit', (e) => e.preventDefault());

writeForm(loadInitial());
update();

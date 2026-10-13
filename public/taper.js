// Nicotine taper calculator. Pure functions shared by the browser (app.js), the Worker (/api/plan) and tests.
//
// Model, in three phases, all expressed as estimated nicotine *absorbed* per day:
//   1. Switch:  cigarettes are replaced by vaping week by week while total nicotine stays level,
//               so withdrawal doesn't fight the switch.
//   2. Taper:   e-liquid strength drops by a fixed percentage each step at the same daily volume.
//               Keeping volume constant keeps the habit (hand-to-mouth, breaks) while nicotine falls.
//   3. Zero:    0 mg/mL liquid for a while, then stop vaping.
// All figures are population estimates; real absorption varies a lot between people and devices.

/** Device presets: absorbed fraction of nicotine in the liquid, usual strengths, comfortable mL/day. */
export const DEVICES = {
  pod: { label: 'Pod / nicotine salt (mouth-to-lung)', absorption: 0.5, maxVolume: 3, strengths: [20, 18, 12, 10, 6, 3] },
  mtl: { label: 'Refillable mouth-to-lung (freebase)', absorption: 0.4, maxVolume: 5, strengths: [18, 12, 10, 6, 3] },
  dtl: { label: 'Sub-ohm / direct-to-lung (freebase)', absorption: 0.3, maxVolume: 15, strengths: [6, 3] },
};

export const PACES = {
  gentle: { label: 'Gentle: 10% every 2 weeks', reduction: 0.10, stepDays: 14 },
  steady: { label: 'Steady: 10% every week', reduction: 0.10, stepDays: 7 },
  brisk: { label: 'Brisk: 20% every week', reduction: 0.20, stepDays: 7 },
};

/** Strengths commonly sold in shops (mg/mL). */
export const SHOP_STRENGTHS = [20, 18, 16, 12, 10, 9, 6, 5, 3, 1.5, 0];

export const DEFAULTS = {
  cigsPerDay: 20,
  mgPerCig: 1.0,       // nicotine absorbed per cigarette (typically ~1 mg, range 0.5–2)
  device: 'pod',
  maxStrength: 20,     // EU/UK legal cap; raise elsewhere
  startStrength: null, // null = pick automatically
  pace: 'steady',
  reduction: null,     // overrides pace
  stepDays: null,      // overrides pace
  switchWeeks: 2,
  zeroWeeks: 2,
  floor: 1.5,          // below this strength, the next step is 0 mg/mL
  startDate: null,     // 'YYYY-MM-DD'
};

const round = (x, d = 1) => Math.round(x * 10 ** d) / 10 ** d;

export class InputError extends Error {}

/** Validate and fill in defaults. Throws InputError with a user-facing message. */
export function normalize(input = {}) {
  const o = { ...DEFAULTS };
  for (const [k, v] of Object.entries(input)) if (v !== undefined && v !== null && v !== '' && k in DEFAULTS) o[k] = v;
  const num = (k, min, max, label) => {
    const n = Number(o[k]);
    if (!Number.isFinite(n) || n < min || n > max) throw new InputError(`${label} must be between ${min} and ${max}.`);
    o[k] = n;
  };
  num('cigsPerDay', 1, 80, 'Cigarettes per day');
  num('mgPerCig', 0.3, 3, 'Nicotine per cigarette');
  num('maxStrength', 3, 60, 'Maximum strength');
  num('switchWeeks', 0, 8, 'Switch weeks');
  num('zeroWeeks', 0, 12, 'Weeks at 0 mg');
  num('floor', 0.5, 6, 'Final strength');
  if (!DEVICES[o.device]) throw new InputError('Unknown device type.');
  if (!PACES[o.pace]) throw new InputError('Unknown pace.');
  o.switchWeeks = Math.round(o.switchWeeks);
  o.zeroWeeks = Math.round(o.zeroWeeks);
  o.reduction = o.reduction == null ? PACES[o.pace].reduction : Number(o.reduction);
  o.stepDays = o.stepDays == null ? PACES[o.pace].stepDays : Number(o.stepDays);
  if (!(o.reduction >= 0.05 && o.reduction <= 0.5)) throw new InputError('Reduction per step must be between 5% and 50%.');
  if (!(Number.isInteger(o.stepDays) && o.stepDays >= 3 && o.stepDays <= 28)) throw new InputError('Step length must be 3–28 days.');
  if (o.startStrength != null) num('startStrength', 1, o.maxStrength, 'Starting strength');
  if (o.startDate != null && (!/^\d{4}-\d{2}-\d{2}$/.test(String(o.startDate)) || Number.isNaN(Date.parse(o.startDate)))) {
    throw new InputError('Start date must be YYYY-MM-DD.');
  }
  return o;
}

/** mL/day of liquid at `strength` that delivers `nicotineMg` absorbed with the device's absorption. */
export const volumeFor = (nicotineMg, strength, absorption) => (strength > 0 ? nicotineMg / (strength * absorption) : 0);

/**
 * Pick the starting strength: the lowest usual strength for the device (≤ max) at which matching the
 * smoker's daily nicotine needs no more than the device's comfortable daily volume. Falls back to the highest.
 */
export function pickStartStrength(dailyNicotine, device, maxStrength) {
  const d = DEVICES[device];
  const capped = d.strengths.filter((s) => s <= maxStrength);
  // Pods can use any legal strength up to the cap; other devices stay within their usual range.
  if (device === 'pod' && !capped.includes(maxStrength)) capped.push(maxStrength);
  const options = (capped.length ? capped : [maxStrength]).sort((a, b) => a - b);
  for (const s of options) if (volumeFor(dailyNicotine, s, d.absorption) <= d.maxVolume) return s;
  return options.at(-1);
}

/** Closest commonly sold strength. */
export const nearestShopStrength = (s) =>
  SHOP_STRENGTHS.reduce((best, x) => (Math.abs(x - s) < Math.abs(best - s) ? x : best), SHOP_STRENGTHS[0]);

/** Mix `strength` from the starting liquid and 0 mg liquid: mL of each per `batch` mL. */
export function mixRecipe(strength, baseStrength, batch = 10) {
  const nic = round((batch * strength) / baseStrength, 1);
  return { batch, nicLiquid: nic, zeroLiquid: round(batch - nic, 1), baseStrength };
}

export function addDays(iso, days) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Build the full plan. */
export function buildPlan(input) {
  const o = normalize(input);
  const dev = DEVICES[o.device];
  const daily = o.cigsPerDay * o.mgPerCig; // absorbed mg/day while smoking
  const autoStrength = pickStartStrength(daily, o.device, o.maxStrength);
  const S0 = o.startStrength ?? autoStrength;
  const fullVolume = volumeFor(daily, S0, dev.absorption);
  // Volume is held at this level during the taper. If matching the smoker would need far more than
  // the device comfortably delivers, it's capped and the plan says so.
  const volume = Math.min(fullVolume, dev.maxVolume * 1.5);
  const warnings = [];
  if (fullVolume > volume) {
    warnings.push(`Matching your smoking at ${S0} mg/mL would take about ${round(fullVolume)} mL a day, so the plan caps it at ${round(volume)} mL. ` +
      `Expect stronger cravings at first. ${o.device === 'pod' ? 'Nicotine patches' : 'A pod with nicotine salt, or nicotine patches,'} can close the gap.`);
  } else if (fullVolume > dev.maxVolume) {
    warnings.push(`At ${S0} mg/mL you'd vape about ${round(fullVolume)} mL a day, more than most people manage on this device. ` +
      (o.device === 'pod'
        ? "If you can't keep up, nicotine patches can cover the rest."
        : 'A pod with nicotine salt delivers the same nicotine with far less liquid.'));
  }
  if (o.startStrength != null && o.startStrength < autoStrength) {
    warnings.push(`Starting below ${autoStrength} mg/mL means vaping a lot of liquid, or getting too little nicotine and craving cigarettes.`);
  }

  const steps = [];
  let day = 0;
  const push = (s) => {
    const step = { ...s, index: steps.length + 1, startDay: day };
    step.nicotine = round(step.cigs * o.mgPerCig + step.volume * step.strength * dev.absorption, 1);
    step.volume = round(step.volume, 1);
    step.pctOfStart = Math.round((step.nicotine / daily) * 100);
    if (o.startDate) step.startDate = addDays(o.startDate, day);
    day += s.days;
    steps.push(step);
  };

  // Phase 1: switch. Week k of n keeps (n-k+1)/(n+1) of the cigarettes; vaping fills the rest.
  for (let k = 1; k <= o.switchWeeks; k++) {
    const cigs = Math.round((o.cigsPerDay * (o.switchWeeks - k + 1)) / (o.switchWeeks + 1));
    const vapeNic = Math.max(0, daily - cigs * o.mgPerCig);
    push({ phase: 'switch', days: 7, cigs, strength: S0, volume: Math.min(volumeFor(vapeNic, S0, dev.absorption), volume) });
  }

  // Phase 2: taper. Strength falls geometrically at constant volume until it drops below the floor.
  push({ phase: 'taper', days: o.stepDays, cigs: 0, strength: S0, volume });
  for (let s = S0 * (1 - o.reduction); s >= o.floor; s *= 1 - o.reduction) {
    push({ phase: 'taper', days: o.stepDays, cigs: 0, strength: round(s, 1), volume });
  }

  // Phase 3: zero nicotine.
  if (o.zeroWeeks > 0) push({ phase: 'zero', days: o.zeroWeeks * 7, cigs: 0, strength: 0, volume });

  for (const st of steps) {
    st.shopStrength = nearestShopStrength(st.strength);
    st.mix = st.strength > 0 && st.strength < S0 ? mixRecipe(st.strength, S0) : null;
  }

  return {
    input: o,
    device: { key: o.device, ...dev },
    dailyNicotine: round(daily, 1),
    startStrength: S0,
    autoStartStrength: autoStrength,
    volume: round(volume, 1),
    totalDays: day,
    totalWeeks: round(day / 7, 1),
    endDate: o.startDate ? addDays(o.startDate, day) : null,
    steps,
    warnings,
  };
}

/** Index of the step active on `todayIso`; -1 before the start, steps.length after the end, null without a start date. */
export function currentStepIndex(plan, todayIso) {
  if (!plan.input.startDate) return null;
  const diff = Math.round((Date.parse(todayIso + 'T00:00:00Z') - Date.parse(plan.input.startDate + 'T00:00:00Z')) / 86400000);
  if (diff < 0) return -1;
  const i = plan.steps.findIndex((s) => diff >= s.startDay && diff < s.startDay + s.days);
  return i === -1 ? plan.steps.length : i;
}

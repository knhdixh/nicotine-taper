// Nicotine taper calculator. Pure functions shared by the browser (app.js), the Worker (/api/plan) and tests.
//
// The plan: on day 1, swap cigarettes for a vape at a strength that matches how much you smoke.
// Then step the e-liquid strength down through strengths sold in French shops, a few weeks per
// step, ending on 0 mg. Cigarettes are French (EU cap: 1 mg nicotine per cigarette).

/** E-liquid strengths (mg/mL) sold in French shops, strongest first. 20 mg is usually nicotine salt. */
export const LADDER = [20, 16, 12, 6, 3, 0];

export const NICOTINE_PER_CIG = 1; // mg, EU/French maximum yield per cigarette

export const PACES = {
  gentle: { label: 'Gentle', weeks: 4 },
  steady: { label: 'Steady', weeks: 3 },
  fast: { label: 'Fast', weeks: 2 },
};

export const DEFAULTS = { cigsPerDay: 20, pace: 'steady', startDate: null };

export class InputError extends Error {}

/** Validate and fill in defaults. Throws InputError with a user-facing message. */
export function normalize(input = {}) {
  const o = { ...DEFAULTS };
  for (const [k, v] of Object.entries(input)) if (v !== undefined && v !== null && v !== '' && k in DEFAULTS) o[k] = v;
  const cigs = Number(o.cigsPerDay);
  if (!Number.isFinite(cigs) || cigs < 1 || cigs > 80) throw new InputError('Cigarettes per day must be between 1 and 80.');
  o.cigsPerDay = Math.round(cigs);
  if (!PACES[o.pace]) throw new InputError('Pace must be gentle, steady or fast.');
  if (o.startDate != null && (!/^\d{4}-\d{2}-\d{2}$/.test(String(o.startDate)) || Number.isNaN(Date.parse(o.startDate)))) {
    throw new InputError('Start date must be YYYY-MM-DD.');
  }
  return o;
}

/** Starting strength from cigarettes per day (usual French vape-shop guidance). */
export function startStrength(cigsPerDay) {
  if (cigsPerDay >= 30) return 20;
  if (cigsPerDay >= 20) return 16;
  if (cigsPerDay >= 10) return 12;
  return 6;
}

export function addDays(iso, days) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Build the plan: one step per strength from the starting one down to 0 mg. */
export function buildPlan(input) {
  const o = normalize(input);
  const S0 = startStrength(o.cigsPerDay);
  const days = PACES[o.pace].weeks * 7;
  const steps = LADDER.slice(LADDER.indexOf(S0)).map((strength, i) => {
    const step = { index: i + 1, strength, startDay: i * days, days, startWeek: i * PACES[o.pace].weeks + 1, endWeek: (i + 1) * PACES[o.pace].weeks };
    if (o.startDate) {
      step.startDate = addDays(o.startDate, step.startDay);
      step.endDate = addDays(o.startDate, step.startDay + days - 1);
    }
    return step;
  });
  const totalDays = steps.length * days;
  return {
    input: o,
    nicotinePerDay: o.cigsPerDay * NICOTINE_PER_CIG,
    startStrength: S0,
    steps,
    totalDays,
    totalWeeks: totalDays / 7,
    endDate: o.startDate ? addDays(o.startDate, totalDays - 1) : null,
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

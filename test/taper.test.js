import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan, normalize, pickStartStrength, mixRecipe, nearestShopStrength, currentStepIndex, InputError } from '../public/taper.js';

test('switch phase keeps total nicotine level while cigarettes fall', () => {
  const plan = buildPlan({ cigsPerDay: 20, switchWeeks: 2 });
  const sw = plan.steps.filter((s) => s.phase === 'switch');
  assert.deepEqual(sw.map((s) => s.cigs), [13, 7]);
  for (const s of sw) assert.ok(Math.abs(s.nicotine - plan.dailyNicotine) < 0.3, `step ${s.index} nicotine ${s.nicotine}`);
});

test('taper holds volume and lowers nicotine by the chosen fraction each step', () => {
  const plan = buildPlan({ cigsPerDay: 20, pace: 'steady' });
  const taper = plan.steps.filter((s) => s.phase === 'taper');
  assert.equal(taper[0].cigs, 0);
  assert.ok(taper.every((s) => s.volume === taper[0].volume));
  for (let i = 1; i < taper.length; i++) {
    const ratio = taper[i].strength / taper[i - 1].strength;
    assert.ok(ratio > 0.87 && ratio < 0.93, `ratio ${ratio}`);
  }
  assert.ok(taper.at(-1).strength >= 1.5);
  assert.equal(plan.steps.at(-1).phase, 'zero');
  assert.equal(plan.steps.at(-1).nicotine, 0);
});

test('nicotine never increases from step to step', () => {
  for (const cigsPerDay of [3, 10, 20, 35, 60]) for (const device of ['pod', 'mtl', 'dtl']) for (const pace of ['gentle', 'steady', 'brisk']) {
    const { steps } = buildPlan({ cigsPerDay, device, pace });
    for (let i = 1; i < steps.length; i++) assert.ok(steps[i].nicotine <= steps[i - 1].nicotine + 0.2, `${cigsPerDay}/${device}/${pace} step ${i}`);
    assert.ok(steps.length < 80);
  }
});

test('start strength: lowest that fits the device, respecting the legal cap', () => {
  assert.equal(pickStartStrength(20, 'pod', 20), 18);  // 12 mg would need 3.3 mL
  assert.equal(pickStartStrength(5, 'pod', 20), 6);
  assert.equal(pickStartStrength(40, 'pod', 20), 20);
  assert.equal(pickStartStrength(40, 'pod', 50), 50);
  assert.equal(pickStartStrength(10, 'dtl', 20), 3);
  assert.equal(pickStartStrength(60, 'dtl', 20), 6);
});

test('heavy smokers get a warning and a capped volume', () => {
  const plan = buildPlan({ cigsPerDay: 60, device: 'pod' });
  assert.equal(plan.volume, 4.5);
  assert.match(plan.warnings[0], /caps it/);
  assert.deepEqual(buildPlan({ cigsPerDay: 15 }).warnings, []);
});

test('pace and overrides change the length', () => {
  const steady = buildPlan({}).totalDays, gentle = buildPlan({ pace: 'gentle' }).totalDays, brisk = buildPlan({ pace: 'brisk' }).totalDays;
  assert.ok(gentle > steady && steady > brisk);
  assert.equal(buildPlan({ stepDays: 10, reduction: 0.25, switchWeeks: 0, zeroWeeks: 0 }).steps[0].days, 10);
});

test('mix recipes and shop strengths', () => {
  assert.deepEqual(mixRecipe(9, 18), { batch: 10, nicLiquid: 5, zeroLiquid: 5, baseStrength: 18 });
  assert.equal(nearestShopStrength(13.1), 12);
  assert.equal(nearestShopStrength(0.4), 0);
});

test('dates and the current step', () => {
  const plan = buildPlan({ startDate: '2026-10-01', switchWeeks: 2 });
  assert.equal(plan.steps[1].startDate, '2026-10-08');
  assert.equal(currentStepIndex(plan, '2026-09-30'), -1);
  assert.equal(currentStepIndex(plan, '2026-10-01'), 0);
  assert.equal(currentStepIndex(plan, '2026-10-15'), 2);
  assert.equal(currentStepIndex(plan, plan.endDate), plan.steps.length);
  assert.equal(currentStepIndex(buildPlan({}), '2026-10-01'), null);
});

test('validation', () => {
  assert.throws(() => normalize({ cigsPerDay: 0 }), InputError);
  assert.throws(() => normalize({ device: 'hookah' }), InputError);
  assert.throws(() => normalize({ startStrength: 30, maxStrength: 20 }), InputError);
  assert.throws(() => normalize({ startDate: 'tomorrow' }), InputError);
  assert.throws(() => normalize({ stepDays: 2 }), InputError);
  assert.equal(normalize({ cigsPerDay: '12' }).cigsPerDay, 12);
});

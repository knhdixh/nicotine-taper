import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan, normalize, startStrength, puffBudget, currentStepIndex, LADDER, InputError } from '../public/taper.js';

test('starting strength follows cigarettes per day', () => {
  assert.equal(startStrength(5), 6);
  assert.equal(startStrength(10), 12);
  assert.equal(startStrength(20), 16);
  assert.equal(startStrength(30), 20);
});

test('steps go down the French ladder from the start strength to 0 mg', () => {
  assert.deepEqual(buildPlan({ cigsPerDay: 20 }).steps.map((s) => s.strength), [16, 12, 6, 3, 0]);
  assert.deepEqual(buildPlan({ cigsPerDay: 40 }).steps.map((s) => s.strength), LADDER);
  assert.deepEqual(buildPlan({ cigsPerDay: 3 }).steps.map((s) => s.strength), [6, 3, 0]);
});

test('vaping starts on day 1 and pace sets weeks per step', () => {
  const steady = buildPlan({ cigsPerDay: 20, pace: 'steady' });
  assert.equal(steady.steps[0].startDay, 0);
  assert.equal(steady.steps[0].days, 21);
  assert.equal(steady.totalWeeks, 15);
  assert.equal(buildPlan({ cigsPerDay: 20, pace: 'gentle' }).totalWeeks, 20);
  assert.equal(buildPlan({ cigsPerDay: 20, pace: 'fast' }).totalWeeks, 10);
  assert.deepEqual(steady.steps.map((s) => [s.startWeek, s.endWeek]), [[1, 3], [4, 6], [7, 9], [10, 12], [13, 15]]);
});

test('dates and the current step', () => {
  const plan = buildPlan({ cigsPerDay: 20, pace: 'fast', startDate: '2026-10-01' });
  assert.equal(plan.steps[0].endDate, '2026-10-14');
  assert.equal(plan.steps[1].startDate, '2026-10-15');
  assert.equal(plan.endDate, '2026-12-09');
  assert.equal(currentStepIndex(plan, '2026-09-30'), -1);
  assert.equal(currentStepIndex(plan, '2026-10-01'), 0);
  assert.equal(currentStepIndex(plan, '2026-10-15'), 1);
  assert.equal(currentStepIndex(plan, '2026-12-09'), 4);
  assert.equal(currentStepIndex(plan, '2026-12-10'), 5);
  assert.equal(currentStepIndex(buildPlan({}), '2026-10-01'), null);
});

test('validation', () => {
  assert.throws(() => normalize({ cigsPerDay: 0 }), InputError);
  assert.throws(() => normalize({ cigsPerDay: 'lots' }), InputError);
  assert.throws(() => normalize({ pace: 'turbo' }), InputError);
  assert.throws(() => normalize({ startDate: 'tomorrow' }), InputError);
  assert.equal(normalize({ cigsPerDay: '12' }).cigsPerDay, 12);
});

test('puff budget replaces cigarettes and spreads over waking hours', () => {
  assert.deepEqual(puffBudget(20), { perDay: 300, perHour: 19 });
  assert.deepEqual(puffBudget(10), { perDay: 150, perHour: 9 });
  assert.deepEqual(puffBudget(1), { perDay: 20, perHour: 1 });
  const plan = buildPlan({ cigsPerDay: 20 });
  assert.equal(plan.puffsPerDay, 300);
  assert.equal(plan.puffsPerHour, 19);
});

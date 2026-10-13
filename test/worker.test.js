import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';

const env = { ASSETS: { fetch: async () => new Response('static') } };
const call = (path, init) => worker.fetch(new Request('https://app.test' + path, init), env);

test('health endpoint', async () => {
  const res = await call('/api/health');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});

test('unknown API route is a JSON 404, other paths go to static assets', async () => {
  assert.equal((await call('/api/nope')).status, 404);
  assert.equal(await (await call('/')).text(), 'static');
});

test('cross-origin writes are rejected', async () => {
  const res = await call('/api/health', { method: 'POST', headers: { Origin: 'https://evil.test' } });
  assert.equal(res.status, 403);
});

test('plan API returns a plan, and 400 for bad input', async () => {
  const res = await call('/api/plan?cigsPerDay=10&device=mtl');
  assert.equal(res.status, 200);
  const plan = await res.json();
  assert.equal(plan.input.cigsPerDay, 10);
  assert.ok(plan.steps.length > 3);
  const bad = await call('/api/plan?cigsPerDay=500');
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /Cigarettes per day/);
});

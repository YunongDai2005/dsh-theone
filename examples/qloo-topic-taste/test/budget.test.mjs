import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DurableBudget } from '../durable-budget.mjs';
import { QlooClient, ModelRouter } from '../agent.mjs';

// Real local SQLite with a SqlStorage-shaped adapter. This is not a test of
// Cloudflare's runtime, persistence gates, billing, or a real provider.
function sql(db) {
  return { exec(query, ...args) { return db.prepare(query).all(...args); } };
}
test('budget survives database reopening, is shared across clients, and never resets on new limits', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'taste-budget-'));
  let db;
  try {
    const path = join(dir, 'budget.db');
    db = new DatabaseSync(path);
    const budget = new DurableBudget(sql(db), { qloo: 3 });
    const outcomes = await Promise.allSettled(Array.from({ length: 10 }, async () => budget.reserve('qloo')));
    assert.equal(outcomes.filter(x => x.status === 'fulfilled').length, 3);
    assert.ok(outcomes.filter(x => x.status === 'rejected').every(x => x.reason.status === 429));
    db.close();
    db = new DatabaseSync(path);
    const reopened = new DurableBudget(sql(db), { qloo: 3 });
    assert.throws(() => reopened.reserve('qloo'), { status: 429 });
    const lowered = new DurableBudget(sql(db), { qloo: 1 });
    assert.throws(() => lowered.reserve('qloo'), { status: 429 });
    assert.throws(() => lowered.reserve('model'), { status: 503 });
  } finally { db?.close(); rmSync(dir, { recursive: true, force: true }); }
});
test('failed provider attempts consume durable quota and later fresh clients cannot fetch', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    const budget = new DurableBudget(sql(db), { qloo: 1, model: 1 });
    for (const provider of ['qloo', 'model']) {
      let fetched = 0;
      const options = { apiKey: 'synthetic', reserveRequest: () => budget.reserve(provider),
        fetchImpl: async () => { fetched++; throw new Error('simulated timeout'); } };
      const call = () => provider === 'qloo'
        ? new QlooClient(options).search('Arrival', 'movie')
        : new ModelRouter(options).plan('new film topic', []);
      await assert.rejects(call, { status: 502 });
      await assert.rejects(call, { status: 429 });
      assert.equal(fetched, 1);
    }
  } finally { db.close(); }
});
test('missing keys do not consume budget; invalid or absent limits fail closed', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    let reserved = 0;
    const opts = { reserveRequest: () => { reserved++; }, fetchImpl: () => assert.fail('unexpected fetch') };
    await assert.rejects(new QlooClient(opts).search('Arrival', 'movie'), { status: 503 });
    await assert.rejects(new ModelRouter(opts).plan('film', []), { status: 503 });
    assert.equal(reserved, 0);
    for (const limit of [undefined, 0, -1, 1.5, NaN, Infinity, '3', 1001]) {
      assert.throws(() => new DurableBudget(sql(db), { qloo: limit }).reserve('qloo'), { status: 503 });
    }
  } finally { db.close(); }
});

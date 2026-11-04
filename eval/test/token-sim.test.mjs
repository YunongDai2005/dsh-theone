import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zstdCompressSync } from 'node:zlib';
import {
  parseClaudeRecords, deriveTurns, simulate, observedTotals, routingAverage,
  assignTopics, decodeZstdFrames, readTopicMap, compactSpec, priceTokens,
  auditDshRecords, runAnalysis, writePrivateResults,
} from '../token-sim.mjs';

const call = (time, input, hit, output) => ({ time, input, miss: input - hit, hit, output, uncached: input - hit, write: 0 });
const tiny = () => deriveTurns([
  { session: 'a', time: 0, userTokens: 10, calls: [call(1000, 100, 0, 10), call(2000, 140, 100, 20)] },
  { session: 'a', time: 3000, userTokens: 10, calls: [call(4000, 170, 140, 5)] },
]);
const opts = { window: 1_000_000, ttlMs: 300_000, sharedPrefix: 0, headroom: 0, reservedOutput: 0, briefTokens: 0 };
const user = (session, time, extra = {}) => ({ type: 'user', sessionId: session, uuid: 'u' + time, timestamp: new Date(time).toISOString(), origin: { kind: 'human' }, message: { content: 'Invented request.' }, ...extra });
const assistant = (session, time, id, input, hit, output, extra = {}) => ({ type: 'assistant', sessionId: session, uuid: 'a' + time, timestamp: new Date(time).toISOString(), message: { id, model: 'fixture-model', usage: { input_tokens: input - hit, cache_read_input_tokens: hit, cache_creation_input_tokens: 0, output_tokens: output } }, ...extra });

test('turn inference preserves tool-loop increments and final output, without counting context twice', () => {
  const turns = tiny();
  assert.deepEqual(turns.map(t => [t.baseTokens, t.growth, t.calls.map(c => c.delta), t.calls.map(c => c.offset)]), [[90, 70, [10, 30], [10, 50]], [90, 15, [10], [10]]]);
});

test('manual forward simulation exactly reproduces all three observed token buckets on hand-made logs', () => {
  const turns = tiny();
  assert.deepEqual(observedTotals(turns), { miss: 170, hit: 240, output: 35 });
  assert.deepEqual(simulate(turns, { ...opts, strategy: 'manual' }).tokens, { miss: 170, hit: 240, output: 35 });
});

test('a content block duplicate is billed once; tool results, meta and notifications are not user turns', () => {
  const a = assistant('a', 2000, 'request-a', 100, 0, 10);
  const data = parseClaudeRecords([
    user('a', 1000), a, { ...a, uuid: 'duplicate-block' },
    user('a', 3000, { origin: undefined, message: { content: [{ type: 'tool_result', content: 'Invented tool response.' }] } }),
    assistant('a', 4000, 'request-b', 140, 100, 20),
    user('a', 5000, { origin: { kind: 'task-notification' }, isMeta: true }),
    assistant('a', 6000, 'request-c', 170, 140, 5),
  ]);
  assert.equal(data.turns.length, 1);
  assert.equal(data.turns[0].calls.length, 3);
  assert.equal(data.stats.duplicateCalls, 1);
});

test('sidechains remain separate, automated origins and repository sessions are excluded', () => {
  const data = parseClaudeRecords([
    user('human', 1000), assistant('human', 2000, 'h', 100, 0, 10),
    user('human', 3000, { isSidechain: true, agentId: 'child' }), assistant('human', 4000, 's', 50, 0, 5, { isSidechain: true, agentId: 'child' }),
    user('auto', 5000, { origin: { kind: 'automation' }, entrypoint: 'codex' }), assistant('auto', 6000, 'x', 200, 0, 20),
    user('repo', 7000, { cwd: 'D:/fictional-repository/eval' }), assistant('repo', 8000, 'r', 300, 0, 30),
  ], { excludeRoots: ['D:/fictional-repository'] });
  assert.equal(data.turns.length, 1);
  assert.deepEqual(data.sidechain.tokens, { miss: 50, hit: 0, output: 5 });
  assert.equal(data.stats.excludedSessions, 2);
});

test('cache TTL expires after the boundary, and unrelated sessions share only the declared prefix', () => {
  const turns = deriveTurns([
    { session: 'a', time: 0, userTokens: 10, calls: [call(0, 100, 0, 10)] },
    { session: 'b', time: 500, userTokens: 10, calls: [call(500, 100, 0, 10)] },
    { session: 'a', time: 1001, userTokens: 10, calls: [call(1001, 120, 0, 10)] },
  ]);
  const r = simulate(turns, { ...opts, strategy: 'manual', ttlMs: 1000, sharedPrefix: 20 });
  assert.deepEqual(r.tokens, { miss: 280, hit: 40, output: 30 });
  const boundary = deriveTurns([{ session: 'a', time: 0, userTokens: 10, calls: [call(0, 100, 0, 10), call(1000, 120, 100, 10)] }]);
  assert.equal(simulate(boundary, { ...opts, strategy: 'manual', ttlMs: 1000 }).tokens.hit, 100);
});

test('different sessions cannot reuse conversation prefixes just because their lengths match', () => {
  const turns = deriveTurns(['a', 'b'].map((session, i) => ({ session, time: i, userTokens: 10, calls: [call(i, 100, 0, 10)] })));
  assert.equal(simulate(turns, { ...opts, strategy: 'manual' }).tokens.hit, 0);
  assert.equal(simulate(turns, { ...opts, strategy: 'single' }).tokens.hit, 100);
});

test('three strategies use a shared topic only when mapped; missing and ambiguous mappings fall back', () => {
  const turns = deriveTurns(['a', 'b', 'c', 'd'].map((session, i) => ({ session, time: i, userTokens: 10, calls: [call(i, 100, 0, 10)] })));
  const map = new Map([['a', new Set(['topic'])], ['b', new Set(['topic'])], ['d', new Set(['left', 'right'])]]);
  const assigned = assignTopics(turns, map);
  assert.deepEqual(assigned.coverage, { sessions: 4, mappedSessions: 2, turns: 4, mappedTurns: 2, ambiguousSessions: 1 });
  const count = strategy => simulate(assigned.turns, { ...opts, strategy }).destinations;
  assert.deepEqual(['single', 'manual', 'theone'].map(count), [1, 4, 3]);
});

test('compaction follows the installed budget rule, charges its own call, and invalidates cache', () => {
  assert.deepEqual(compactSpec({ window: 200000, headroom: 65536, reservedOutput: 8192 }), { threshold: 126272, retain: 30689 });
  const turns = deriveTurns([{ session: 'a', time: 0, userTokens: 10, calls: [call(0, 100, 0, 10), call(1, 800, 100, 20), call(2, 850, 800, 5)] }]);
  const r = simulate(turns, { ...opts, strategy: 'manual', window: 1000, summaryTokens: 10, summaryInstructionTokens: 5, trace: true });
  assert.equal(r.compactions, 1);
  assert.deepEqual(r.trace.map(c => [c.kind, c.input, c.hit, c.output]), [['worker', 100, 0, 10], ['compaction', 645, 100, 10], ['worker', 260, 0, 20], ['worker', 310, 260, 5]]);
  assert.deepEqual(r.tokens, { miss: 955, hit: 360, output: 45 });
});

test('large context resets are isolated instead of becoming negative counterfactual growth', () => {
  const data = parseClaudeRecords([user('a', 0), assistant('a', 1, 'x', 100000, 0, 20), { type: 'system', sessionId: 'a', subtype: 'compact_boundary' }, user('a', 2), assistant('a', 3, 'y', 10000, 0, 20)]);
  assert.equal(data.turns.length, 0);
  assert.equal(data.stats.resetSessions, 1);
});

test('routing and card usage are averaged per user message including zero-call rows', () => {
  const r = routingAverage([{ usage: { input: 100, cache_hit: 40, output: 10 }, card_usage: [{ input: 20, cache_hit: 5, output: 4 }] }, { usage: { input: 0, cache_hit: 0, output: 0 }, card_usage: [] }]);
  assert.deepEqual(r.router, { miss: 30, hit: 20, output: 5 });
  assert.deepEqual(r.card, { miss: 7.5, hit: 2.5, output: 2 });
  const a = assignTopics(tiny(), new Map()).turns;
  const withRouting = simulate(a, { ...opts, strategy: 'theone', overhead: r });
  assert.deepEqual(withRouting.tokens, { miss: 245, hit: 285, output: 49 });
});

test('brief injection is retained and charged at every start, with first-only available as a sensitivity', () => {
  const a = assignTopics(tiny(), new Map()).turns;
  const every = simulate(a, { ...opts, strategy: 'theone', briefTokens: 10, briefMode: 'every-turn' });
  const once = simulate(a, { ...opts, strategy: 'theone', briefTokens: 10, briefMode: 'new-topic' });
  assert.equal(every.briefInjected, 20);
  assert.equal(once.briefInjected, 10);
  assert.equal(every.tokens.miss + every.tokens.hit, 450);
  assert.equal(once.tokens.miss + once.tokens.hit, 440);
});

test('fragmentation targets 1.35 topics and low mixing moves whole turns reproducibly', () => {
  const turns = assignTopics(deriveTurns(Array.from({ length: 100 }, (_, i) => ({ session: 's' + Math.floor(i / 5), time: i, userTokens: 10, calls: [call(i, 100 + 20 * (i % 5), 0, 10)] }))), new Map()).turns;
  const a = simulate(turns, { ...opts, strategy: 'theone-split', splitRate: 1.35 });
  const b = simulate(turns, { ...opts, strategy: 'theone-mix', mixRate: .02, seed: 7 });
  assert.equal(a.destinations, 27);
  assert.equal(b.mixedTurns, 2);
  assert.deepEqual(b, simulate(turns, { ...opts, strategy: 'theone-mix', mixRate: .02, seed: 7 }));
});

test('a globally interleaved call preserves the original timing even within a long user turn', () => {
  const turns = deriveTurns([
    { session: 'a', time: 0, userTokens: 10, calls: [call(0, 100, 0, 10), call(1000, 120, 0, 10)] },
    { session: 'b', time: 500, userTokens: 10, calls: [call(500, 100, 0, 10)] },
  ]);
  const r = simulate(turns, { ...opts, strategy: 'manual', sharedPrefix: 20, ttlMs: 600, trace: true });
  assert.deepEqual(r.trace.map(c => c.time), [0, 500, 1000]);
  assert.deepEqual(r.tokens, { miss: 280, hit: 40, output: 30 });
});

test('Zstandard concatenated frames are all read; a torn final frame is explicitly counted', () => {
  const a = zstdCompressSync(Buffer.from('{"type":"session"}\n'));
  const b = zstdCompressSync(Buffer.from('{"type":"assistant/message"}\n'));
  assert.equal(decodeZstdFrames(Buffer.concat([a, b])).text, '{"type":"session"}\n{"type":"assistant/message"}\n');
  const torn = decodeZstdFrames(Buffer.concat([a, b.subarray(0, 8)]));
  assert.equal(torn.frames, 1);
  assert.equal(torn.tornFrames, 1);
});

test('DSH usage excludes cache reads from inputTokens and never bills seeded history twice', () => {
  const usage = { inputTokens: 10, cacheReadTokens: 80, cacheWriteTokens: 5, outputTokens: 7, totalTokens: 102 };
  const audit = auditDshRecords([{ type: 'session', id: 'd', delegationDepth: 0 }, { type: 'assistant/message', data: { usage } }, { type: 'session/end-seed' }, { type: 'user/message', data: { source: { kind: 'user' } } }, { type: 'assistant/message', data: { usage } }]);
  assert.equal(audit.calls, 1);
  assert.equal(audit.seededCalls, 1);
  assert.deepEqual(audit.tokens, { miss: 15, hit: 80, output: 7 });
});

test('SQLite mapping is read without schema changes, and conflicts are not silently resolved', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const dir = mkdtempSync(join(tmpdir(), 'token-sim-test-'));
  const dbPath = join(dir, 'contexts.db');
  const db = new DatabaseSync(dbPath);
  db.exec("CREATE TABLE contexts(id TEXT, working_session_id TEXT); CREATE TABLE context_sources(context_id TEXT,session_id TEXT); INSERT INTO contexts VALUES('t1','worker'); INSERT INTO context_sources VALUES('t1','source'),('t2','source');");
  db.close();
  const before = readFileSync(dbPath);
  const r = await readTopicMap(dbPath);
  assert.deepEqual([...r.map.get('worker')], ['t1']);
  assert.equal(r.map.get('source').size, 2);
  assert.deepEqual(readFileSync(dbPath), before);
});

test('prices include Sonnet cache writes, with the 24-hour case explicitly hypothetical', () => {
  const t = { miss: 1e6, hit: 1e6, output: 1e6 };
  assert.equal(priceTokens(t, { miss: .15, hit: .003, output: .6 }), .753);
  assert.equal(priceTokens(t, { miss: 2, hit: .1, output: 10, write5m: 2.5, write1h: 4 }, 300000), 12.6);
  assert.equal(priceTokens(t, { miss: 2, hit: .1, output: 10, write5m: 2.5, write1h: 4 }, 3600000), 14.1);
});

test('the offline entry point rejects unsafe output locations and persists no message, path or session ID', async () => {
  const root = mkdtempSync(join(tmpdir(), 'token-sim-private-test-'));
  const records = [user('private-session', 0), assistant('private-session', 1, 'private-call', 100, 0, 10)];
  const result = await runAnalysis({ claudeRecords: records, topicMap: new Map(), routeRows: [{ usage: { input: 10, cache_hit: 0, output: 1 }, card_usage: [] }], windows: [1000000], ttls: [300000], ...opts });
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes('private-session'));
  assert.ok(!serialized.includes('Invented request.'));
  assert.equal(result.scenarios.length, 5);
  assert.throws(() => writePrivateResults(result, root, { repoRoot: root }), /ignored private directory/);
});

test('a card placeholder with missing usage is counted and imputed from measured cards, not silently zeroed', () => {
  const r = routingAverage([
    { usage: { input: 10, output: 1 }, card_usage: [{ input: 20, cache_hit: 5, output: 4 }] },
    { usage: { input: 10, output: 1 }, card_usage: [{ layer: 'card' }] },
  ]);
  assert.equal(r.cardMissingUsage, 1);
  assert.deepEqual(r.card, { miss: 15, hit: 5, output: 4 });
  assert.deepEqual(r.cardImputedTokens, { miss: 15, hit: 5, output: 4 });
});

test('parent chains keep a delayed assistant response with its initiating user turn', () => {
  const data = parseClaudeRecords([
    user('a', 0, { uuid: 'u-first' }),
    user('a', 1, { uuid: 'u-second', parentUuid: 'u-first' }),
    assistant('a', 2, 'r-first', 100, 0, 10, { parentUuid: 'u-first' }),
    assistant('a', 3, 'r-second', 120, 100, 10, { parentUuid: 'u-second' }),
  ]);
  assert.deepEqual(data.turns.map(t => t.calls.length), [1, 1]);
  assert.ok(!JSON.stringify(data.turns).includes('u-first'));
});

test('zero-call human turns still pay routing overhead but do not invent worker calls', () => {
  const turns = deriveTurns([
    { session: 'a', time: 0, userTokens: 10, calls: [] },
    { session: 'a', time: 1, userTokens: 10, calls: [call(2, 100, 0, 10)] },
  ]);
  assert.equal(turns.length, 2);
  const result = simulate(turns, { ...opts, strategy: 'theone', overhead: { router: { miss: 10, hit: 0, output: 1 }, card: { miss: 0, hit: 0, output: 0 } } });
  assert.deepEqual(result.tokens, { miss: 120, hit: 0, output: 12 });
  assert.equal(result.calls, 1);
});

test('the summarizer sends only the replaced prefix and cannot cache-hit its new instruction', () => {
  const turns = deriveTurns([{ session: 'a', time: 0, userTokens: 700, calls: [call(0, 790, 0, 10), call(1, 800, 790, 20)] }]);
  const result = simulate(turns, { ...opts, strategy: 'manual', window: 1000, summaryTokens: 10, summaryInstructionTokens: 5, trace: true });
  assert.deepEqual(result.trace[1], { time: 1, kind: 'compaction', input: 645, hit: 640, output: 10 });
});

test('attachment ancestry connects assistant calls to human prompts without retaining attachment content', () => {
  const data = parseClaudeRecords([
    user('a', 0, { uuid: 'start' }),
    { type: 'attachment', sessionId: 'a', uuid: 'bridge', parentUuid: 'start', timestamp: new Date(1).toISOString(), attachment: { content: 'DO NOT RETAIN THIS' } },
    user('a', 2, { uuid: 'next' }),
    assistant('a', 3, 'r', 100, 0, 10, { parentUuid: 'bridge' }),
  ]);
  assert.deepEqual(data.turns.map(t => t.calls.length), [1, 0]);
  assert.ok(!JSON.stringify(data).includes('DO NOT RETAIN THIS'));
});

test('counterfactual strategies use the same fixed envelope, while observed replay preserves original inputs', async () => {
  const result = await runAnalysis({ claudeRecords: [user('a', 0), assistant('a', 1, 'a', 100, 0, 10), user('b', 2), assistant('b', 3, 'b', 200, 0, 10)],
    topicMap: new Map(), routeRows: [{ usage: { input: 0, output: 0 }, card_usage: [] }], ...opts, sensitivity: false, windows: [1000000], ttls: [300000] });
  const single = result.scenarios.find(s => s.strategy === 'single');
  assert.equal(single.tokens.miss + single.tokens.hit, 316);
  assert.deepEqual(result.reconstruction.tokens, { miss: 300, hit: 0, output: 20 });
});

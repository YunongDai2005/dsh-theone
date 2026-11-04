#!/usr/bin/env node
/**
 * Offline token counterfactual. Node >=24; no network or model clients.
 * Run: node eval/token-sim.mjs
 * Options: --claude-root DIR --dsh-root DIR --contexts-db FILE
 * --routing-open FILE --routing-closed FILE --output DIR
 * --windows 1000000,200000 --ttls 300,3600,86400 (seconds)
 * --fixed-base N (default: median source envelope)
 * --shared-prefix 4096 --brief-tokens 1000 --brief-mode every-turn|new-topic
 * --summary-tokens 2048 --summary-instruction-tokens 600
 * --headroom 65536 --reserved-output 8192 --split-rate 1.35 --mix-rate .01
 * --seed 20261104 --prices FILE --exclude-root DIR (repeatable)
 * --from ISO_DATE --to ISO_DATE (inclusive from, exclusive to)
 * Price JSON: {deepseek:{miss,hit,output},sonnet:{miss,hit,output,write5m,write1h}}.
 * Rates: USD/million tokens. Sonnet misses are assumed cache writes; 24h uses
 * the 1h write price as a hypothetical retention scenario, not a native offer.
 * Persist only aggregates and run-local aliases in the Git-ignored directory.
 * Do not import the application's store: it runs migrations.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, statSync, realpathSync, createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { join, resolve, relative, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { zstdDecompressSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';

class SimulationError extends Error {}
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULTS = Object.freeze({ window: 1_000_000, ttlMs: 300_000, sharedPrefix: 4096,
  briefTokens: 1000, briefMode: 'every-turn', summaryTokens: 2048, summaryInstructionTokens: 600,
  headroom: 65536, reservedOutput: 8192, splitRate: 1.35, mixRate: .01, seed: 20261104 });
export const PRICES = Object.freeze({ asOf: '2026-11-04',
  deepseek: { label: 'DeepSeek V4.1 Flash off-peak', miss: .15, hit: .003, output: .6,
    source: 'https://api-docs.deepseek.com/quick_start/pricing/' },
  sonnet: { label: 'Claude Sonnet 5.5', miss: 2, hit: .1, output: 10, write5m: 2.5, write1h: 4,
    source: 'https://platform.claude.com/docs/en/about-claude/pricing' },
});
const zero = () => ({ miss: 0, hit: 0, output: 0 });
const add = (a, b, n = 1) => { for (const k of ['miss', 'hit', 'output']) a[k] += (b[k] ?? 0) * n; return a; };
const sum = rows => rows.reduce((a, b) => add(a, b), zero());
const finite = n => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const stamp = v => typeof v === 'number' ? v : Date.parse(v);
const normalizePath = p => String(p ?? '').replace(/\\/g, '/').replace(/\/$/, '').toLowerCase();
const inside = (p, root) => normalizePath(p) === normalizePath(root) || normalizePath(p).startsWith(normalizePath(root) + '/');
const excludedPath = (p, roots) => roots.some(root => inside(p, root)) || /(?:^|[\\/])(?:\.codex(?:-runs)?|codex-runs|eval-runs)(?:[\\/]|$)/i.test(p ?? '');
function estimateUserTokens(content) {
  // Only the initial envelope/user split uses text length. All later deltas
  // use observed token usage; text is discarded before storing intermediate data.
  const text = typeof content === 'string' ? content : (content ?? []).filter(b => b?.type === 'text').map(b => b.text ?? '').join('\n');
  return Math.max(1, Math.ceil(Buffer.byteLength(text, 'utf8') / 3));
}
function humanRecord(r) {
  if (r.isMeta || r.isCompactSummary || r.isVisibleInTranscriptOnly) return false;
  if (r.origin?.kind) return r.origin.kind === 'human';
  if (r.turnOrigin) return r.turnOrigin === 'human';
  const c = r.message?.content;
  if (Array.isArray(c) && c.some(b => b?.type === 'tool_result')) return false;
  if (typeof c === 'string' && /^\s*<(?:task-notification|local-command|command-name|system-reminder)/i.test(c)) return false;
  return typeof c === 'string' || Array.isArray(c) && c.some(b => ['text', 'image'].includes(b?.type));
}
function projectClaudeRecord(r, sideFromFile = false) {
  if (!['user', 'assistant', 'system'].includes(r.type)) return r.sessionId && r.uuid ? { type: 'link', sessionId: r.sessionId, uuid: r.uuid, parent: r.parentUuid, human: false, side: Boolean(r.isSidechain || r.agentId || sideFromFile) } : null;
  const m = r.message ?? {}, content = m.content;
  const firstText = typeof content === 'string' ? content : Array.isArray(content) ? content.find(b => b.type === 'text')?.text ?? '' : '';
  return { type: r.type, sessionId: r.sessionId, uuid: r.uuid, parent: r.parentUuid, time: stamp(r.timestamp),
    cwd: r.cwd, side: Boolean(r.isSidechain || r.agentId || sideFromFile), agent: r.agentId ?? '',
    human: r.type === 'user' && humanRecord(r), userTokens: r.type === 'user' ? estimateUserTokens(content) : 0,
    automated: /codex|automation|benchmark|eval-runner|headless/i.test(r.entrypoint ?? '') ||
      ['automation', 'scheduled', 'eval', 'codex'].includes(r.origin?.kind) ||
      r.type === 'user' && /^\s*(?:You are Codex\b|\[automated evaluation\]|<automated-task>)/i.test(firstText),
    compact: r.subtype === 'compact_boundary', request: m.id ?? r.requestId ?? r.uuid,
    synthetic: r.isApiErrorMessage || m.model === '<synthetic>', usage: m.usage };
}
function claudeUsage(u) {
  if (!u || !['input_tokens', 'output_tokens'].every(k => finite(u[k]))) return null;
  const hit = u.cache_read_input_tokens ?? 0, write = u.cache_creation_input_tokens ?? 0;
  if (!finite(hit) || !finite(write)) return null;
  return { input: u.input_tokens + hit + write, miss: u.input_tokens + write, hit, output: u.output_tokens,
    uncached: u.input_tokens, write, write5m: u.cache_creation?.ephemeral_5m_input_tokens ?? 0,
    write1h: u.cache_creation?.ephemeral_1h_input_tokens ?? 0 };
}
export function parseClaudeRecords(records, options = {}) {
  const roots = options.excludeRoots ?? [], sessions = new Map(), sideCalls = new Map(), seenUsers = new Set();
  const stats = { records: 0, duplicateCalls: 0, duplicateUsers: 0, inconsistentDuplicates: 0,
    missingUsage: 0, invalidTime: 0, syntheticCalls: 0, excludedSessions: 0, excludedCalls: 0,
    resetSessions: 0, resetCalls: 0, orphanCalls: 0, noCallTurns: 0, negativeDeltas: 0, parentAttributed: 0, timeAttributed: 0 };
  for (const raw of records) {
    const r = 'human' in raw ? raw : projectClaudeRecord(raw);
    if (!r || !r.sessionId) continue;
    stats.records++;
    let s = sessions.get(r.sessionId);
    if (!s) sessions.set(r.sessionId, s = { id: r.sessionId, users: [], calls: new Map(), parents: new Map(), excluded: false, compact: false });
    if (!r.side && r.uuid) s.parents.set(r.uuid, r.parent);
    if (!r.side) { s.excluded ||= r.automated || excludedPath(r.cwd, roots); s.compact ||= r.compact; }
    if (r.type === 'user' && r.human && !r.side) {
      const key = r.sessionId + ':' + r.uuid;
      if (r.uuid && seenUsers.has(key)) { stats.duplicateUsers++; continue; }
      if (r.uuid) seenUsers.add(key);
      if (!Number.isFinite(r.time)) { stats.invalidTime++; continue; }
      s.users.push({ uuid: r.uuid, session: s.id, time: r.time, userTokens: r.userTokens, calls: [] });
    }
    if (r.type !== 'assistant') continue;
    if (r.synthetic) { stats.syntheticCalls++; continue; }
    const u = claudeUsage(r.usage);
    if (!u) { stats.missingUsage++; continue; }
    if (!Number.isFinite(r.time)) { stats.invalidTime++; continue; }
    const pool = r.side ? sideCalls : s.calls, key = r.sessionId + ':' + r.agent + ':' + r.request;
    const prev = pool.get(key);
    if (prev) {
      stats.duplicateCalls++;
      if (prev.input !== u.input || prev.output !== u.output) stats.inconsistentDuplicates++;
      if (u.output > prev.output) Object.assign(prev, u);
      prev.time = Math.min(prev.time, r.time);
    } else pool.set(key, { parent: r.parent, time: r.time, ...u });
  }
  const turns = [], excludedTokens = zero(), resetTokens = zero();
  for (const s of sessions.values()) {
    const calls = [...s.calls.values()].sort((a, b) => a.time - b.time);
    if (!calls.length) continue;
    if (s.excluded) { stats.excludedSessions++; stats.excludedCalls += calls.length; add(excludedTokens, sum(calls)); continue; }
    if (s.compact || calls.some((c, i) => i && c.input - calls[i - 1].input - calls[i - 1].output < -8192)) {
      stats.resetSessions++; stats.resetCalls += calls.length; add(resetTokens, sum(calls)); continue;
    }
    s.users.sort((a, b) => a.time - b.time);
    const userById = new Map(s.users.filter(u => u.uuid).map(u => [u.uuid, u]));
    let index = -1;
    for (const c of calls) {
      while (index + 1 < s.users.length && s.users[index + 1].time <= c.time) index++;
      let ancestor = c.parent, owner;
      const visited = new Set();
      while (ancestor && !visited.has(ancestor)) {
        if (userById.has(ancestor)) { owner = userById.get(ancestor); break; }
        visited.add(ancestor); ancestor = s.parents.get(ancestor);
      }
      if (owner) stats.parentAttributed++;
      else if (index >= 0) { owner = s.users[index]; stats.timeAttributed++; }
      else { stats.orphanCalls++; continue; }
      const { parent, ...usage } = c;
      owner.calls.push(usage);
    }
    for (const { uuid, ...turn } of s.users) { if (!turn.calls.length) stats.noCallTurns++; turns.push(turn); }
  }
  const derived = deriveTurns(turns);
  stats.negativeDeltas = derived.flatMap(t => t.calls).filter(c => c.delta < 0).length;
  return { turns: derived, stats, excludedTokens, resetTokens,
    sidechain: { calls: sideCalls.size, tokens: sum([...sideCalls.values()]) } };
}
export function deriveTurns(rawTurns) {
  const turns = [...rawTurns].sort((a, b) => a.time - b.time).map(t => ({
    session: t.session, time: t.time, userTokens: t.userTokens, baseTokens: 0, growth: 0, calls: [],
  }));
  const ordered = [...rawTurns].sort((a, b) => a.time - b.time);
  const events = ordered.flatMap((t, i) => t.calls.map(c => ({ c, i }))).sort((a, b) => a.c.time - b.c.time);
  const state = new Map();
  for (const { c, i } of events) {
    const turn = turns[i];
    let st = state.get(turn.session);
    if (!st) {
      const base = Math.max(0, c.input - Math.min(turn.userTokens ?? 0, c.input));
      state.set(turn.session, st = { base, lastEnd: base });
    }
    const delta = c.input - st.lastEnd;
    turn.calls.push({ ...c, delta, offset: turn.growth + delta });
    turn.growth += delta + c.output;
    st.lastEnd = c.input + c.output;
  }
  for (const turn of turns) turn.baseTokens = state.get(turn.session)?.base ?? 0;
  return turns;
}
export function observedTotals(turns) { return sum(turns.flatMap(t => t.calls)); }
export function assignTopics(turns, map) {
  const sessions = new Set(turns.map(t => t.session)), mapped = new Set(), ambiguous = new Set();
  const assigned = turns.map(t => {
    const candidates = map.get(t.session);
    const ids = candidates instanceof Set ? [...candidates] : typeof candidates === 'string' ? [candidates] : candidates ?? [];
    const unique = [...new Set(ids)];
    if (unique.length === 1) mapped.add(t.session);
    if (unique.length > 1) ambiguous.add(t.session);
    return { ...t, topic: unique.length === 1 ? 'mapped:' + unique[0] : 'fallback:' + t.session };
  });
  return { turns: assigned, coverage: { sessions: sessions.size, mappedSessions: mapped.size,
    turns: turns.length, mappedTurns: assigned.filter(t => mapped.has(t.session)).length, ambiguousSessions: ambiguous.size } };
}

export function compactSpec(options) {
  const o = { ...DEFAULTS, ...options }, budget = o.window - o.reservedOutput;
  const threshold = Math.floor(Math.min(o.window * .8, budget - o.headroom));
  const retain = Math.floor(budget * .16);
  if (!(threshold > retain && retain >= 0)) throw new SimulationError('Invalid compaction budget');
  return { threshold, retain };
}
function orderKey(seed, n) { return createHash('sha256').update(String(seed) + ':' + n).digest('hex'); }
function destinationsFor(turns, o) {
  const base = turns.map(t => o.strategy === 'single' ? 'single' : o.strategy === 'manual' ? t.session : t.topic ?? 'fallback:' + t.session);
  const groups = new Map();
  base.forEach((key, i) => { if (!groups.has(key)) groups.set(key, []); groups.get(key).push(i); });
  let mixedTurns = 0;
  if (o.strategy === 'theone-split') {
    const candidates = [...groups].filter(([, indexes]) => indexes.length > 1).sort((a, b) => orderKey(o.seed, a[1][0]).localeCompare(orderKey(o.seed, b[1][0])));
    let left = Math.round(groups.size * (o.splitRate - 1));
    for (const [key, indexes] of candidates) {
      if (!left) break;
      const parts = Math.min(indexes.length, 1 + Math.min(left, Math.ceil(o.splitRate) - 1));
      indexes.forEach((index, i) => { base[index] = key + ':split:' + Math.floor(i * parts / indexes.length); });
      left -= parts - 1;
    }
  } else if (o.strategy === 'theone-mix' && groups.size > 1) {
    const keys = [...groups.keys()], firstSeen = new Map([...groups].map(([k, ids]) => [k, ids[0]]));
    const candidates = turns.map((_, i) => i).filter(i => keys.some(k => k !== base[i] && firstSeen.get(k) < i))
      .sort((a, b) => orderKey(o.seed, a).localeCompare(orderKey(o.seed, b)));
    for (const index of candidates.slice(0, Math.round(turns.length * o.mixRate))) {
      const alternatives = keys.filter(k => k !== base[index] && firstSeen.get(k) < index);
      base[index] = alternatives[parseInt(orderKey(o.seed, index).slice(0, 8), 16) % alternatives.length];
      mixedTurns++;
    }
  }
  return { base, mixedTurns };
}
export function simulate(turns, options = {}) {
  const o = { ...DEFAULTS, strategy: 'manual', ...options };
  const spec = compactSpec(o), isTheOne = o.strategy.startsWith('theone');
  const assigned = destinationsFor(turns, o), states = new Map(), started = new Set();
  const tokens = zero(), worker = zero(), compression = zero(), routing = zero(), cards = zero();
  const trace = [], events = turns.flatMap((t, i) => t.calls.length ? t.calls.map((c, j) => ({ c, t, i, j })) : [{ c: { time: t.time, overheadOnly: true }, t, i, j: 0 }])
    .sort((a, b) => a.c.time - b.c.time || a.i - b.i || a.j - b.j);
  let globalAt = -Infinity, sharedAvailable = 0, compactions = 0, briefInjected = 0, clippedDeltas = 0;
  const charge = (s, time, input, output, kind, cold = false, observedHit) => {
    const sessionHot = time - s.lastAt >= 0 && time - s.lastAt <= o.ttlMs;
    const sharedHot = time - globalAt >= 0 && time - globalAt <= o.ttlMs;
    const hit = observedHit ?? (cold ? 0 : Math.min(input - (kind === 'compaction' ? o.summaryInstructionTokens : 0), Math.max(sessionHot ? s.lastInput : 0, sharedHot ? Math.min(sharedAvailable, s.base, o.sharedPrefix) : 0)));
    const billed = { miss: input - hit, hit, output };
    add(tokens, billed); add(kind === 'worker' ? worker : compression, billed);
    if (o.trace) trace.push({ time, kind, input, hit, output });
    s.lastAt = time; s.lastInput = input;
    globalAt = time; sharedAvailable = Math.min(s.base, o.sharedPrefix);
  };
  for (const { c, t, i } of events) {
    if (c.overheadOnly) {
      if (isTheOne && o.overhead) { add(routing, o.overhead.router); add(cards, o.overhead.card); add(tokens, o.overhead.router); add(tokens, o.overhead.card); }
      continue;
    }
    const key = assigned.base[i];
    let s = states.get(key);
    const fresh = !s;
    if (!s) states.set(key, s = { base: o.fixedBase ?? t.baseTokens, history: 0, lastAt: -Infinity, lastInput: 0 });
    if (!started.has(i)) {
      started.add(i);
      if (isTheOne) {
        const brief = o.briefMode === 'every-turn' || fresh ? o.briefTokens : 0;
        briefInjected += brief; s.history += brief;
        if (o.overhead) { add(routing, o.overhead.router); add(cards, o.overhead.card); add(tokens, o.overhead.router); add(tokens, o.overhead.card); }
      }
    }
    const nextHistory = s.history + c.delta;
    if (nextHistory < 0) clippedDeltas++;
    s.history = Math.max(0, nextHistory);
    let input = s.base + s.history, cold = false;
    if (!o.disableCompaction && input >= spec.threshold) {
      const after = s.base + Math.min(s.history, spec.retain) + o.summaryTokens;
      if (after >= spec.threshold || after >= input) throw new SimulationError('Compaction cannot shrink under the selected budget');
      charge(s, c.time, input - Math.min(s.history, spec.retain) + o.summaryInstructionTokens, o.summaryTokens, 'compaction');
      s.history = after - s.base; input = after; cold = true; compactions++;
    }
    charge(s, c.time, input, c.output, 'worker', cold, o.observedCache ? c.hit : undefined);
    s.history += c.output;
  }
  const result = { tokens, parts: { worker, compression, routing, cards }, calls: events.filter(e => !e.c.overheadOnly).length,
    compactions, destinations: states.size, mixedTurns: assigned.mixedTurns, briefInjected, clippedDeltas,
    threshold: spec.threshold, retain: spec.retain };
  if (o.trace) result.trace = trace;
  return result;
}
export function routingAverage(rows) {
  if (!rows.length) throw new SimulationError('Routing measurements are empty');
  const router = zero(), card = zero();
  let cardCalls = 0, cardMissingUsage = 0, missingRows = 0, errors = 0;
  const unpack = u => {
    if (!u || !finite(u.input) || !finite(u.output) || !finite(u.cache_hit ?? 0) || (u.cache_hit ?? 0) > u.input) throw new SimulationError('Invalid routing usage');
    return { miss: u.input - (u.cache_hit ?? 0), hit: u.cache_hit ?? 0, output: u.output };
  };
  for (const r of rows) {
    if (!r.usage) { missingRows++; continue; }
    add(router, unpack(r.usage));
    for (const u of r.card_usage ?? []) {
      if (u.input === undefined && u.output === undefined) { cardMissingUsage++; continue; }
      add(card, unpack(u)); cardCalls++;
    }
    if (r.error) errors++;
  }
  if (missingRows) throw new SimulationError('Routing rows lack usage; refusing to assume zero');
  const cardImputedTokens = zero();
  if (cardMissingUsage) {
    if (!cardCalls) throw new SimulationError('No measured card usage for imputation');
    add(cardImputedTokens, card, cardMissingUsage / cardCalls);
    add(card, cardImputedTokens);
  }
  for (const t of [router, card]) for (const k of Object.keys(t)) t[k] /= rows.length;
  return { rows: rows.length, router, card, cardCalls, cardMissingUsage, cardImputedTokens, errors };
}
export function decodeZstdFrames(bytes) {
  const pieces = []; let offset = 0, frames = 0, tornFrames = 0;
  while (offset < bytes.length) {
    try {
      const r = zstdDecompressSync(bytes.subarray(offset), { info: true });
      if (!r.engine.bytesWritten) throw new SimulationError('No frame progress');
      pieces.push(r.buffer); offset += r.engine.bytesWritten; frames++;
    } catch (error) {
      if (error.code === 'Z_BUF_ERROR' || /unexpected end|incomplete|premature/i.test(error.message)) { tornFrames++; break; }
      throw new SimulationError('Corrupt Zstandard frame');
    }
  }
  return { text: Buffer.concat(pieces).toString('utf8'), frames, tornFrames };
}
export function auditDshRecords(records) {
  const result = { sessions: records.some(r => r.type === 'session') ? 1 : 0, humanTurns: 0, calls: 0,
    missingUsage: 0, seededCalls: 0, tokens: zero(), seededTokens: zero(), invalidUsage: 0 };
  const lastSeed = records.findLastIndex(r => r.type === 'session/end-seed');
  records.forEach((r, i) => {
    if (r.type === 'user/message' && r.data?.source?.kind === 'user' && i > lastSeed) result.humanTurns++;
    if (r.type !== 'assistant/message') return;
    const u = r.data?.usage;
    if (!u) { if (i > lastSeed) result.missingUsage++; return; }
    if (![u.inputTokens, u.outputTokens, u.cacheReadTokens ?? 0, u.cacheWriteTokens ?? 0].every(finite)) { result.invalidUsage++; return; }
    const t = { miss: u.inputTokens + (u.cacheWriteTokens ?? 0), hit: u.cacheReadTokens ?? 0, output: u.outputTokens };
    if (i <= lastSeed) { result.seededCalls++; add(result.seededTokens, t); }
    else { result.calls++; add(result.tokens, t); }
  });
  return result;
}
export async function readTopicMap(dbPath) {
  const result = { map: new Map(), stats: { available: false, tables: {}, mappingPairs: 0, ambiguousSessions: 0 } };
  if (!existsSync(dbPath)) return result;
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    db.exec('PRAGMA query_only=ON; BEGIN');
    const names = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name));
    for (const [table, column] of [['contexts', 'working_session_id'], ['context_sources', 'session_id'], ['context_origins', 'session_id'], ['context_source_ranges', 'session_id'], ['history_turns', 'session_id']]) {
      if (!names.has(table)) continue;
      const id = table === 'contexts' ? 'id' : 'context_id';
      const rows = db.prepare(`SELECT ${column} AS session, ${id} AS topic FROM ${table}`).all();
      result.stats.tables[table] = rows.length;
      for (const row of rows) {
        if (!row.session || !row.topic) continue;
        if (!result.map.has(row.session)) result.map.set(row.session, new Set());
        result.map.get(row.session).add(row.topic);
      }
    }
    db.exec('ROLLBACK');
    result.stats.available = true;
    result.stats.mappingPairs = [...result.map.values()].reduce((n, ids) => n + ids.size, 0);
    result.stats.ambiguousSessions = [...result.map.values()].filter(ids => ids.size > 1).length;
  } finally { db.close(); }
  return result;
}
export function priceTokens(tokens, prices, ttlMs = 300000) {
  const miss = ttlMs <= 300000 ? prices.write5m ?? prices.miss : prices.write1h ?? prices.miss;
  return (tokens.miss * miss + tokens.hit * prices.hit + tokens.output * prices.output) / 1e6;
}
const percentError = (actual, predicted) => actual ? (predicted - actual) / actual * 100 : predicted ? null : 0;
function calibration(observed, predicted, prices, ttlMs) {
  const metrics = {};
  for (const k of ['miss', 'hit', 'output']) metrics[k] = percentError(observed[k], predicted[k]);
  metrics.input = percentError(observed.miss + observed.hit, predicted.miss + predicted.hit);
  for (const k of ['deepseek', 'sonnet']) metrics[k] = percentError(priceTokens(observed, prices[k], ttlMs), priceTokens(predicted, prices[k], ttlMs));
  return metrics;
}
function aliases(turns) {
  const sessions = new Map(), topics = new Map();
  return turns.map(t => {
    if (!sessions.has(t.session)) sessions.set(t.session, 's' + sessions.size);
    if (!topics.has(t.topic)) topics.set(t.topic, 't' + topics.size);
    return { ...t, session: sessions.get(t.session), topic: topics.get(t.topic) };
  });
}

export async function runAnalysis(options = {}) {
  const parsed = parseClaudeRecords(options.claudeRecords ?? [], options);
  let turns = parsed.turns.filter(t => (!options.from || t.time >= stamp(options.from)) && (!options.to || t.time < stamp(options.to)));
  // A date slice starts from the source context at its first selected call.
  if (options.from || options.to) turns = deriveTurns(turns.map(t => ({ ...t, calls: t.calls.map(({ delta, offset, ...c }) => c) })));
  if (!turns.length) throw new SimulationError('No eligible human turns with usage');
  const assigned = assignTopics(turns, options.topicMap ?? new Map());
  turns = aliases(assigned.turns);
  const overhead = routingAverage(options.routeRows ?? []), observed = observedTotals(turns), prices = options.prices ?? PRICES;
  const bases = [...new Map(turns.map(t => [t.session, t.baseTokens])).values()].sort((a, b) => a - b);
  const fixedBase = options.fixedBase ?? Math.round((bases[Math.floor((bases.length - 1) / 2)] + bases[Math.floor(bases.length / 2)]) / 2);
  const o = { ...DEFAULTS, ...options, fixedBase, overhead };
  const windows = options.windows ?? [1000000, 200000], ttls = options.ttls ?? [300000, 3600000, 86400000];
  const scenarios = [], calibrationRows = [];
  const replay = simulate(turns, { ...o, strategy: 'manual', fixedBase: undefined, disableCompaction: true, observedCache: true });
  for (const window of windows) for (const ttlMs of ttls) {
    const group = [];
    for (const strategy of ['single', 'manual', 'theone', 'theone-split', 'theone-mix']) {
      const result = simulate(turns, { ...o, window, ttlMs, strategy });
      const costs = Object.fromEntries(['deepseek', 'sonnet'].map(k => [k, priceTokens(result.tokens, prices[k], ttlMs)]));
      const row = { window, ttlMs, strategy, ...result, costs };
      group.push(row); scenarios.push(row);
      if (strategy === 'manual') calibrationRows.push({ window, ttlMs, errorsPct: calibration(observed, result.tokens, prices, ttlMs) });
    }
    for (const row of group.filter(r => r.strategy.startsWith('theone'))) {
      row.savings = {};
      for (const baseline of ['single', 'manual']) {
        const b = group.find(r => r.strategy === baseline);
        row.savings[baseline] = Object.fromEntries(['deepseek', 'sonnet'].map(k => [k, { usd: b.costs[k] - row.costs[k], pct: (1 - row.costs[k] / b.costs[k]) * 100 }]));
      }
    }
  }
  const sensitivity = [];
  if (options.sensitivity !== false) {
    const variants = [
      ['brief-zero', { briefTokens: 0 }], ['brief-500', { briefTokens: 500 }], ['brief-2000', { briefTokens: 2000 }],
      ['brief-new-topic-only', { briefMode: 'new-topic' }], ['shared-zero', { sharedPrefix: 0 }],
      ['shared-32768', { sharedPrefix: 32768 }], ['summary-512', { summaryTokens: 512 }],
      ['summary-8192', { summaryTokens: 8192 }], ['simple-window-rule', { headroom: 0, reservedOutput: 0 }],
      ['source-envelopes', { fixedBase: undefined }], ['fixed-base-4096', { fixedBase: 4096 }], ['fixed-base-65536', { fixedBase: 65536 }],
    ];
    for (const window of windows) for (const [name, change] of variants) for (const strategy of ['single', 'manual', 'theone']) {
      const r = simulate(turns, { ...o, window, ttlMs: ttls[0], strategy, ...change });
      sensitivity.push({ name, window, ttlMs: ttls[0], strategy, ...r, costs: Object.fromEntries(['deepseek', 'sonnet'].map(k => [k, priceTokens(r.tokens, prices[k], ttls[0])])) });
    }
  }
  const seedSweep = [];
  if (options.sensitivity !== false) for (const strategy of ['theone-split', 'theone-mix']) {
    for (let seed = 1; seed <= 10; seed++) {
      const r = simulate(turns, { ...o, window: windows[0], ttlMs: ttls[0], strategy, seed });
      seedSweep.push({ seed, strategy, destinations: r.destinations, mixedTurns: r.mixedTurns,
        costs: Object.fromEntries(['deepseek', 'sonnet'].map(k => [k, priceTokens(r.tokens, prices[k], ttls[0])])) });
    }
  }
  const calls = turns.flatMap(t => t.calls), sessionCount = new Set(turns.map(t => t.session)).size;
  return { schemaVersion: 1, prices, parameters: { ...DEFAULTS, fixedBase, windows, ttls, ...Object.fromEntries(Object.keys(DEFAULTS).filter(k => options[k] !== undefined).map(k => [k, options[k]])) },
    dataset: { sessions: sessionCount, turns: turns.length, activeTurns: turns.filter(t => t.calls.length).length, calls: calls.length,
      first: new Date(Math.min(...turns.map(t => t.time))).toISOString(), last: new Date(Math.max(...calls.map(c => c.time))).toISOString(),
      observed, rawInput: calls.reduce((n, c) => n + c.uncached, 0), cacheCreation: calls.reduce((n, c) => n + c.write, 0),
      negativeDeltas: calls.filter(c => c.delta < 0).length,
      cacheWrite5m: calls.reduce((n, c) => n + c.write5m, 0), cacheWrite1h: calls.reduce((n, c) => n + c.write1h, 0),
      initialEnvelopeMin: Math.min(...turns.map(t => t.baseTokens)), initialEnvelopeMax: Math.max(...turns.map(t => t.baseTokens)),
      overlappingTurns: turns.filter((t, i) => turns.slice(0, i).some(prev => (prev.calls.at(-1)?.time ?? prev.time) > t.time)).length },
    exclusions: { ...parsed.stats, excludedTokens: parsed.excludedTokens, resetTokens: parsed.resetTokens },
    sidechain: parsed.sidechain, coverage: assigned.coverage, overhead,
    reconstruction: { tokens: replay.tokens, errorsPct: calibration(observed, replay.tokens, prices, ttls[0]) },
    calibration: calibrationRows, scenarios, sensitivity, seedSweep, turns };
}
function walk(root, extension) {
  if (!existsSync(root)) return [];
  if (statSync(root).isFile()) return [root];
  return readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(e =>
    e.isSymbolicLink() ? [] : e.isDirectory() ? walk(join(root, e.name), extension) : e.name.endsWith(extension) ? [join(root, e.name)] : []);
}
async function loadClaude(root) {
  const files = walk(root, '.jsonl'), records = [], manifest = [];
  let malformedLines = 0;
  for (const [i, file] of files.entries()) {
    const digest = createHash('sha256'), before = statSync(file), input = createReadStream(file);
    input.on('data', chunk => digest.update(chunk));
    for await (const line of createInterface({ input, crlfDelay: Infinity })) {
      if (!line.trim()) continue;
      try { const r = projectClaudeRecord(JSON.parse(line), /[\\/]subagents[\\/]/i.test(file)); if (r) records.push(r); }
      catch { malformedLines++; }
    }
    const after = statSync(file);
    manifest.push({ source: 'claude-' + i, bytes: before.size, sha256: digest.digest('hex'), changedDuringRead: before.size !== after.size || before.mtimeMs !== after.mtimeMs });
  }
  return { records, manifest, stats: { files: files.length, malformedLines, changedDuringRead: manifest.filter(r => r.changedDuringRead).length } };
}
function loadDsh(root, roots) {
  const files = walk(root, '.zstd'), all = [], eligible = [], manifest = [];
  let frames = 0, tornFrames = 0, malformedLines = 0, excludedSessions = 0;
  for (const [i, file] of files.entries()) {
    const bytes = readFileSync(file), decoded = decodeZstdFrames(bytes); frames += decoded.frames; tornFrames += decoded.tornFrames;
    const records = [];
    for (const line of decoded.text.split('\n')) { if (line.trim()) { try { records.push(JSON.parse(line)); } catch { malformedLines++; } } }
    const audit = auditDshRecords(records), header = records.find(r => r.type === 'session');
    all.push(audit);
    if (excludedPath(header?.cwd, roots) || header?.delegationDepth > 0) excludedSessions++; else eligible.push(audit);
    manifest.push({ source: 'dsh-' + i, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  const combine = items => items.reduce((a, b) => { for (const [k, v] of Object.entries(b)) typeof v === 'number' ? a[k] = (a[k] ?? 0) + v : add(a[k] ??= zero(), v); return a; }, {});
  return { files: files.length, frames, tornFrames, malformedLines, excludedSessions, all: combine(all), eligible: combine(eligible), manifest };
}
function readRows(file) { return readFileSync(file, 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l)); }
export function writePrivateResults(result, output, { repoRoot = REPO } = {}) {
  const privateRoot = resolve(repoRoot, 'eval/data/private-real/token-sim'), destination = resolve(output);
  if (!inside(destination, privateRoot)) throw new SimulationError('Output must be in the ignored private directory');
  let parent = destination;
  while (!existsSync(parent)) parent = dirname(parent);
  if (normalizePath(realpathSync(parent)) !== normalizePath(parent)) throw new SimulationError('Output must not traverse a symlink');
  try { execFileSync('git', ['check-ignore', '-q', '--', relative(repoRoot, join(destination, 'summary.json'))], { cwd: repoRoot, stdio: 'pipe' }); }
  catch (error) {
    // Some Windows sandboxes allow shell git but deny Node child processes.
    // This deliberately narrow fallback proves the repository's existing final
    // ignore rule applies; it never changes Git configuration or ignores.
    const rules = readFileSync(join(repoRoot, '.gitignore'), 'utf8').split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#'));
    const nested = ['eval', 'eval/data', 'eval/data/private-real', 'eval/data/private-real/token-sim'];
    if (!['EPERM', 'EACCES'].includes(error.code) || rules.at(-1) !== 'eval/data/private-*/' ||
        nested.some(p => existsSync(join(repoRoot, p, '.gitignore')))) {
      throw new SimulationError('Output must be in a Git-ignored private directory');
    }
  }
  mkdirSync(destination, { recursive: true });
  const { turns, ...summary } = result;
  writeFileSync(join(destination, 'summary.json'), JSON.stringify(summary, null, 2) + '\n', 'utf8');
  writeFileSync(join(destination, 'turns.json'), JSON.stringify(turns) + '\n', 'utf8');
}
function positiveList(value) {
  const items = value.split(',').map(Number);
  if (!items.length || items.some(v => !Number.isFinite(v) || v <= 0)) throw new SimulationError('Invalid numeric list');
  return items;
}
async function main() {
  const { values: a } = parseArgs({ options: Object.fromEntries([
    'claude-root', 'dsh-root', 'contexts-db', 'routing-open', 'routing-closed', 'output', 'windows', 'ttls',
    'fixed-base', 'shared-prefix', 'brief-tokens', 'brief-mode', 'summary-tokens', 'summary-instruction-tokens',
    'headroom', 'reserved-output', 'split-rate', 'mix-rate', 'seed', 'prices', 'from', 'to',
  ].map(k => [k, { type: 'string' }]).concat([['help', { type: 'boolean' }], ['exclude-root', { type: 'string', multiple: true }]])) });
  if (a.help) { console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].replace(/^#![^\n]*\n/, '') + '*/'); return; }
  const excludeRoots = [REPO, ...(a['exclude-root'] ?? [])], options = { excludeRoots, from: a.from, to: a.to };
  for (const [flag, key] of Object.entries({ 'fixed-base': 'fixedBase', 'shared-prefix': 'sharedPrefix', 'brief-tokens': 'briefTokens', 'summary-tokens': 'summaryTokens',
    'summary-instruction-tokens': 'summaryInstructionTokens', headroom: 'headroom', 'reserved-output': 'reservedOutput', 'split-rate': 'splitRate', 'mix-rate': 'mixRate', seed: 'seed' })) {
    if (a[flag] !== undefined) { options[key] = Number(a[flag]); if (!finite(options[key])) throw new SimulationError('Invalid numeric parameter'); }
  }
  if (options.mixRate > 1 || options.splitRate < 1) throw new SimulationError('Invalid perturbation rate');
  if (a['brief-mode']) { if (!['every-turn', 'new-topic'].includes(a['brief-mode'])) throw new SimulationError('Invalid briefing mode'); options.briefMode = a['brief-mode']; }
  if (a.windows) options.windows = positiveList(a.windows);
  if (a.ttls) options.ttls = positiveList(a.ttls).map(v => v * 1000);
  if (a.prices) {
    options.prices = JSON.parse(readFileSync(a.prices, 'utf8'));
    for (const name of ['deepseek', 'sonnet']) if (!['miss', 'hit', 'output'].every(k => finite(options.prices[name]?.[k]))) throw new SimulationError('Invalid prices');
  }
  for (const key of ['from', 'to']) if (options[key] && !Number.isFinite(stamp(options[key]))) throw new SimulationError('Invalid date boundary');
  const claude = await loadClaude(a['claude-root'] ?? join(homedir(), '.claude/projects'));
  const mapping = await readTopicMap(a['contexts-db'] ?? join(homedir(), '.dsh/theone/contexts.db'));
  const routeFiles = ['open', 'closed'].map(mode => a['routing-' + mode] ?? join(REPO, 'eval/data/interleave-v0/predictions/cache-5e36590a72d5/none-' + mode + '.jsonl'));
  const routeSets = routeFiles.map(readRows);
  const result = await runAnalysis({ ...options, claudeRecords: claude.records, topicMap: mapping.map, routeRows: routeSets.flat() });
  result.ingestion = claude.stats; result.mappingDatabase = mapping.stats;
  result.routingRuns = routeSets.map((rows, i) => ({ mode: ['open', 'closed'][i], ...routingAverage(rows) }));
  result.dsh = loadDsh(a['dsh-root'] ?? join(homedir(), '.dsh/sessions'), excludeRoots); result.manifest = claude.manifest;
  result.implementation = { compaction: createHash('sha256').update(readFileSync(join(REPO, 'node_modules/@deepseek-ai/dsh-compaction-basic/lib/index.js'))).digest('hex'),
    worker: createHash('sha256').update(readFileSync(join(REPO, 'src/index.ts'))).digest('hex') };
  writePrivateResults(result, a.output ?? join(REPO, 'eval/data/private-real/token-sim'));
  console.log(JSON.stringify({ dataset: result.dataset, coverage: result.coverage, exclusions: result.exclusions,
    sidechain: result.sidechain, ingestion: result.ingestion, routing: result.overhead, mapping: result.mappingDatabase,
    dsh: { ...result.dsh, manifest: undefined }, reconstruction: result.reconstruction, calibration: result.calibration,
    main: result.scenarios.filter(r => r.window === result.parameters.windows[0] && r.ttlMs === result.parameters.ttls[0]) }, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error instanceof SimulationError ? error.message : 'token-sim failed; source details suppressed for privacy.'); process.exitCode = 1; });
}

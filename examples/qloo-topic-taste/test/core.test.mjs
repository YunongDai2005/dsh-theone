import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TasteStore, TasteAgent, QlooClient, ModelRouter, TYPES } from '../core.mjs';
import { createApp } from '../server.mjs';

// All API responses below are deliberately synthetic. They are NOT Qloo recordings or live results.
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222', C = '33333333-3333-4333-8333-333333333333';
const entity = (id, name, subtype = TYPES.movie) => ({ entity_id: id, name, subtype });
function fakeQloo(fn, options = {}) { return new QlooClient({ apiKey: 'synthetic-key', fetchImpl: async (url, init) => { assert.equal(init.headers['X-Api-Key'], 'synthetic-key'); assert.equal(init.redirect, 'error'); return { ok: true, json: async () => fn(new URL(url)) }; }, ...options }); }
function setup(qloo) { const store = new TasteStore(); const owner = store.visitor(); return { store, owner, agent: new TasteAgent(store, qloo, null) }; }

test('search types arrays normalize only explicit category matches for confirmed favorites', async () => {
  const qloo = fakeQloo(() => ({ results: [
    { entity_id: A, name: 'Synthetic search movie', types: [TYPES.movie] },
    { entity_id: B, name: 'Wrong category', types: [TYPES.book] },
    { entity_id: C, name: 'Conflicting category', subtype: TYPES.book, types: [TYPES.movie] },
    { entity_id: C, name: 'Missing category' },
    { entity_id: 'invalid', name: 'Invalid identifier', types: [TYPES.movie] },
  ] }));
  const { store, owner, agent } = setup(qloo);
  try {
    const topic = store.createTopic(owner, 'Search schema');
    const result = await agent.search(owner, topic.id, 'Synthetic movie', 'movie');
    assert.deepEqual(result.candidates.map(row => ({ id: row.id, type: row.type })), [{ id: A, type: TYPES.movie }]);
    agent.confirm(owner, result.token, A);
    assert.equal(store.topic(owner, topic.id).seeds[0].type, TYPES.movie);
  } finally { store.close(); }
});

test('topic signals never bleed into a different topic, including cross-domain recommendations', async () => {
  const sent = [];
  const qloo = fakeQloo(url => { sent.push(url); return url.pathname === '/search' ? { results: [entity(url.searchParams.get('query') === 'Family fixture' ? A : B, 'Synthetic favorite')] } : { success: true, results: { entities: [entity(C, 'Synthetic book', TYPES.book)] } }; });
  const { store, owner, agent } = setup(qloo);
  try {
    const family = store.createTopic(owner, 'Family weekend'), solo = store.createTopic(owner, 'Solo evening');
    const first = await agent.search(owner, family.id, 'Family fixture', 'movie'); agent.confirm(owner, first.token, A);
    const second = await agent.search(owner, solo.id, 'Solo fixture', 'movie'); agent.confirm(owner, second.token, B);
    const result = await agent.recommend(owner, solo.id, 'book');
    assert.equal(sent.at(-1).searchParams.get('signal.interests.entities'), B);
    assert.equal(sent.at(-1).searchParams.get('filter.exclude.entities'), B);
    assert.equal(sent.at(-1).searchParams.get('filter.type'), TYPES.book);
    assert.deepEqual(result.basedOn.map(s => s.id), [B]); assert.equal(result.picks[0].id, C);
    await agent.recommend(owner, family.id, 'movie'); assert.equal(sent.at(-1).searchParams.get('signal.interests.entities'), A);
  } finally { store.close(); }
});
test('foreign topics and candidate tokens cannot be read or confirmed', async () => {
  const { store, owner, agent } = setup(fakeQloo(() => ({ results: [entity(A, 'Synthetic')] })));
  try {
    const stranger = store.visitor(), topic = store.createTopic(owner, 'Private topic');
    await assert.rejects(agent.search(stranger, topic.id, 'x', 'movie'), /not available/);
    const search = await agent.search(owner, topic.id, 'x', 'movie');
    assert.throws(() => agent.confirm(stranger, search.token, A), /expired/);
    assert.throws(() => agent.confirm(owner, search.token, B), /from this search/);
    assert.equal(store.topic(owner, topic.id).seeds.length, 0);
    agent.confirm(owner, search.token, A); assert.throws(() => agent.confirm(owner, search.token, A), /expired/);
  } finally { store.close(); }
});
test('expired candidates do not silently become preferences', async () => {
  const { store, owner, agent } = setup(fakeQloo(() => ({ results: [entity(A, 'Synthetic')] })));
  try { const topic = store.createTopic(owner, 'Test'), result = await agent.search(owner, topic.id, 'x', 'movie'); agent.pending.get(result.token).expires = 0;
    assert.throws(() => agent.confirm(owner, result.token, A), /expired/); assert.equal(store.topic(owner, topic.id).seeds.length, 0);
  } finally { store.close(); }
});
test('favorites survive a real SQLite close/reopen and still enforce ownership', () => {
  const dir = mkdtempSync(join(tmpdir(), 'theone-taste-')); const path = join(dir, 'taste.db'); let store = new TasteStore(path);
  try { const owner = store.visitor(), topic = store.createTopic(owner, 'Persistent'); store.addSeed(owner, topic.id, { id: A, name: 'Synthetic favorite', type: TYPES.movie }); store.close(); store = new TasteStore(path);
    assert.equal(store.visitor(owner), owner); assert.equal(store.topic(owner, topic.id).seeds[0].id, A); assert.throws(() => store.topic(store.visitor(), topic.id), /not available/);
  } finally { store.close(); rmSync(dir, { recursive: true }); }
});
test('no favorite means no upstream call, and upstream seeds are filtered from picks', async () => {
  let calls = 0; const qloo = fakeQloo(() => { calls++; return { results: { entities: [entity(A, 'Input favorite'), entity(C, 'New pick')] } }; });
  await assert.rejects(qloo.recommend([], 'movie'), /confirmed favorite/); assert.equal(calls, 0);
  assert.deepEqual((await qloo.recommend([{ id: A }], 'movie')).map(row => row.id), [C]);
});
test('no key, malformed payload, rate limit and redirects never produce substitute picks', async () => {
  const missing = new QlooClient({ fetchImpl: () => { throw new Error('must not call'); } }); await assert.rejects(missing.search('x', 'movie'), /key pending/);
  await assert.rejects(fakeQloo(() => ({ results: { unexpected: [] } })).search('x', 'movie'), /unexpected response/);
  const limited = fakeQloo(() => ({ results: [] }), { maxRequests: 1 }); await limited.search('x', 'movie'); await assert.rejects(limited.search('x', 'movie'), /limit/);
  const failed = new QlooClient({ apiKey: 'private', fetchImpl: async () => ({ ok: false, status: 429, text: () => 'private upstream debug' }) });
  await assert.rejects(failed.search('x', 'movie'), err => err.status === 429 && !err.message.includes('private'));
  assert.throws(() => new QlooClient({ apiKey: 'private', baseURL: 'https://attacker.example' }), /official/);
});
test('model cannot invent a catalog ID or unsupported operation', async () => {
  function router(plan) { return new ModelRouter({ apiKey: 'synthetic', fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(plan) } }] }) }) }); }
  await assert.rejects(router({ topicId: 'foreign', action: 'recommend', category: 'movie' }).plan('x', []), /unambiguous/);
  await assert.rejects(router({ action: 'terminal' }).plan('x', []), /unsupported/);
  const valid = await router({ topicId: 'one', newTopicTitle: null, action: 'search', category: 'movie', query: 'Arrival' }).plan('x', [{ id: 'one', title: 'Quiet evening', seeds: [{ name: 'Private favorite' }] }]); assert.equal(valid.query, 'Arrival');
});
test('only topic titles enter the routing request, with a hard request cap', async () => {
  let messages; const router = new ModelRouter({ apiKey: 'synthetic', maxRequests: 1, fetchImpl: async (url, init) => { messages = JSON.parse(init.body).messages; return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ action: 'clarify', question: 'Which topic?' }) } }] }) }; } });
  await router.plan('Find a movie', [{ id: 'one', title: 'Quiet night', seeds: [{ name: 'Unshared favorite' }] }]);
  assert.ok(!JSON.stringify(messages).includes('Unshared favorite')); await assert.rejects(router.plan('Again', []), /limit/);
});
test('missing Qloo does not spend model quota or create ghost topics', async () => {
  const store = new TasteStore(), owner = store.visitor(); const agent = new TasteAgent(store, new QlooClient(), { plan: () => { throw new Error('must not call model'); } });
  try { await assert.rejects(agent.chat(owner, 'Remember Arrival'), /key pending/); assert.equal(store.topics(owner).length, 0); } finally { store.close(); }
});
test('bounded Nemotron plans disable reasoning; other model requests omit the provider-specific option', async () => {
  const bodies = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body); bodies.push(body);
    const truncated = body.model === 'nvidia/nemotron-3-super-120b-a12b' && body.chat_template_kwargs?.enable_thinking !== false;
    return { ok: true, json: async () => ({ choices: [{ finish_reason: truncated ? 'length' : 'stop', message: {
      content: truncated ? '' : JSON.stringify({ action: 'clarify', question: 'Which topic and category?' }) } }] }) };
  };
  const result = await new ModelRouter({ apiKey: 'synthetic', fetchImpl }).plan('More like that one', []);
  assert.equal(result.action, 'clarify'); assert.equal(bodies[0].max_tokens, 400);
  await new ModelRouter({ apiKey: 'synthetic', model: 'other-compatible-model', fetchImpl }).plan('More like that one', []);
  assert.ok(!Object.hasOwn(bodies[1], 'chat_template_kwargs'));
});
test('truncated or mixed-intent model output is rejected before a recommendation can run', async () => {
  const plan = { topicId: 'one', newTopicTitle: null, action: 'recommend', category: 'movie', query: '' };
  const topics = [{ id: 'one', title: 'Movie night' }];
  const router = (content, finish_reason) => new ModelRouter({ apiKey: 'synthetic', fetchImpl: async () => ({ ok: true,
    json: async () => ({ choices: [{ finish_reason, message: { content: JSON.stringify(content) } }] }) }) });
  await assert.rejects(router(plan, 'length').plan('More movies', topics), /cut short/);
  await assert.rejects(router({ ...plan, query: 'Arrival' }, 'stop').plan('Remember Arrival', topics), /mixed saving/);
});
test('HTTP sessions ignore client owner IDs, enforce origin and do not expose server keys', async () => {
  const store = new TasteStore(), qloo = fakeQloo(() => ({ results: [] })), router = new ModelRouter({ apiKey: 'private-model-key', fetchImpl: async () => ({ ok: false, status: 503 }) }); const app = createApp({ store, qloo, router });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve)); const base = `http://127.0.0.1:${app.address().port}`;
  try {
    const a = await fetch(`${base}/api/state`), cookieA = a.headers.get('set-cookie').split(';')[0], json = await a.json(); assert.ok(!JSON.stringify(json).includes('private-model-key'));
    const b = await fetch(`${base}/api/state`), cookieB = b.headers.get('set-cookie').split(';')[0];
    const post = (cookie, path, body, origin) => fetch(`${base}/api/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie, ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(body) });
    const created = await (await post(cookieA, 'topics', { title: 'A only' })).json();
    const denied = await post(cookieB, 'search', { topicId: created.topic.id, owner: cookieA.split('=')[1], query: 'x', category: 'movie' }); assert.equal(denied.status, 404);
    assert.equal((await post(cookieA, 'topics', { title: 'CSRF' }, 'https://other.example')).status, 403);
    assert.equal((await (await fetch(`${base}/api/state`, { headers: { Cookie: cookieA } })).json()).topics.length, 1);
    const failure = await post(cookieA, 'chat', { message: 'x' }); assert.equal(failure.status, 502); // Simulated upstream failure, no external API call.
  } finally { await new Promise(resolve => app.close(resolve)); store.close(); }
});

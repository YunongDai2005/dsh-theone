import assert from 'node:assert/strict';
import { TasteStore, TasteAgent, QlooClient, ModelRouter } from './core.mjs';

if (!process.env.QLOO_API_KEY || !process.env.LLM_API_KEY) throw new Error('Both legitimately issued QLOO_API_KEY and LLM_API_KEY are required. No fixture fallback.');
const trace = [];
const qloo = new QlooClient({ apiKey: process.env.QLOO_API_KEY, baseURL: process.env.QLOO_BASE_URL, maxRequests: 6,
  fetchImpl: async (url, init) => { const u = new URL(url); trace.push({ path: u.pathname, type: u.searchParams.get('filter.type'), signals: u.searchParams.get('signal.interests.entities') }); return fetch(url, init); } });
const router = new ModelRouter({ apiKey: process.env.LLM_API_KEY, baseURL: process.env.LLM_BASE_URL, model: process.env.LLM_MODEL, maxRequests: 3 });
const store = new TasteStore(), owner = store.visitor(), agent = new TasteAgent(store, qloo, router);
try {
  const quiet = store.createTopic(owner, 'Quiet science fiction evenings'), family = store.createTopic(owner, 'Family animation weekend');
  for (const [topic, title] of [[quiet, 'Arrival'], [family, 'Spirited Away']]) {
    const result = await agent.search(owner, topic.id, title, 'movie');
    const exact = result.candidates.filter(row => row.name.toLowerCase() === title.toLowerCase());
    assert.equal(exact.length, 1, `Need one exact real Qloo match for ${title}; do not guess.`);
    agent.confirm(owner, result.token, exact[0].id);
  }
  const solo = await agent.recommend(owner, quiet.id, 'book'), together = await agent.recommend(owner, family.id, 'movie');
  assert.ok(solo.picks.length > 0 && together.picks.length > 0, 'Both actual recommendation responses must be nonempty.');
  const reads = trace.filter(row => row.path === '/v2/insights');
  assert.equal(reads[0].signals, store.topic(owner, quiet.id).seeds.map(s => s.id).join(','));
  assert.equal(reads[1].signals, store.topic(owner, family.id).seeds.map(s => s.id).join(','));
  assert.notEqual(reads[0].signals, reads[1].signals);
  const existing = await router.plan('For my family animation weekend, recommend another movie from the favorites already saved.', store.topics(owner));
  assert.equal(existing.topicId, family.id); assert.equal(existing.action, 'recommend');
  const fresh = await router.plan('Start a separate topic called Sunday jazz listening. Remember that I like Miles Davis.', store.topics(owner));
  assert.equal(fresh.topicId, null); assert.equal(fresh.action, 'search'); assert.ok(fresh.newTopicTitle);
  console.log(JSON.stringify({ status: 'PASS', actualQlooCalls: qloo.calls, actualModelCalls: router.calls, exactMatchesConfirmed: 2, isolatedSignals: true, nonemptyRecommendationResponses: 2, existingTopicRouting: true, newTopicRouting: true, browserJourneyVerified: false, hostedDemoVerified: false }));
} finally { store.close(); }

import assert from 'node:assert/strict';
import { ModelRouter } from './core.mjs';

if (!process.env.LLM_API_KEY) throw new Error('A legitimately issued model key is required. No fixture fallback.');
const router = new ModelRouter({ apiKey: process.env.LLM_API_KEY, baseURL: process.env.LLM_BASE_URL, model: process.env.LLM_MODEL, maxRequests: 3 });
const topics = [{ id: 'family', title: 'Family animation weekend' }, { id: 'quiet', title: 'Quiet science fiction evenings' }];
const existing = await router.plan('For my family animation weekend, recommend another movie from the favorites already saved.', topics);
assert.equal(existing.topicId, 'family'); assert.equal(existing.action, 'recommend'); assert.equal(existing.category, 'movie');
const fresh = await router.plan('Start a separate topic called Sunday jazz listening. Remember that I like Miles Davis.', topics);
assert.equal(fresh.topicId, null); assert.ok(fresh.newTopicTitle); assert.equal(fresh.action, 'search'); assert.equal(fresh.category, 'artist'); assert.equal(fresh.query, 'Miles Davis');
const ambiguous = await router.plan('Give me more like that one.', topics);
assert.equal(ambiguous.action, 'clarify'); assert.ok(ambiguous.question);
console.log(JSON.stringify({ status: 'PASS', actualModelRequests: router.calls, model: router.model, syntheticInputs: true,
  existingTopic: true, newTopic: true, ambiguousClarification: true, actualQlooRequests: 0,
  endToEndAppVerified: false, browserJourneyVerified: false, hostedDemoVerified: false }));

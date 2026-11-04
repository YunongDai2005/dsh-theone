import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { DshRouter, RouterFailure, validateRoutingDecision } from '../src/llm-router.ts'
import { textResponse } from './harness.ts'

const input = { text: 'Plan the garden', contexts: [{ id: 'garden', title: 'Garden', summary: '', entities: [], keywords: [], lastState: '' }] }
const valid = { action: 'EXISTING', contextId: 'garden', reason: 'named' }
function fixture(responses: (options: GenerateOptions, n: number) => AsyncIterable<StreamChunk>, timeout = 1000, now = Date.now, variant: 'none' | 'compact' = 'none') {
  const requests: GenerateOptions[] = []
  const llm = {
    resolveModelInfo: async () => ({ provider: 'fixture', id: 'fixture', name: 'fixture' }),
    prepareCall: async () => ({ config: { provider: 'fixture', model: 'fixture' }, stream(options: GenerateOptions) {
      requests.push(options); return responses(options, requests.length)
    } }),
  }
  const router = new DshRouter(llm as never, () => ({ provider: 'fixture', model: 'fixture' }), timeout, now, variant)
  return { router, requests }
}
function* answer(value: unknown) { yield* textResponse(typeof value === 'string' ? value : JSON.stringify(value)) }

for (const kind of ['json', 'decision', 'incomplete', 'compact', 'server', 'network']) test(`one retry recovers ${kind} with the identical request and accumulates usage`, async () => {
  const app = fixture(async function* (_, n) {
    if (n === 1) {
      if (kind === 'network') throw new Error('private transport message')
      if (kind === 'server') { yield { type: 'finish', reason: { kind: 'error', failure: { code: 'TEST_FAILURE', message: 'private', status: 503 } } }; return }
      if (kind === 'incomplete') { yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 3 } }; yield { type: 'finish', reason: { kind: 'max-tokens' } }; return }
      yield* answer(kind === 'json' ? '{private invalid' : { ...valid, contextId: 'unknown' }); return
    }
    yield* answer(valid)
  }, 1000, Date.now, kind === 'compact' ? 'compact' : 'none')
  const result = await app.router.decide(input)
  assert.equal(result.decision.contextId, 'garden')
  assert.equal(app.requests.length, 2)
  assert.deepEqual(app.requests[0], app.requests[1])
  const attempts = (result as any).attempts
  assert.deepEqual(attempts.map((a: any) => a.attempt), [1, 2])
  assert.equal(attempts[0].errorCode, { json: 'ROUTER_INVALID_JSON', decision: 'ROUTER_INVALID_DECISION', incomplete: 'ROUTER_RESPONSE_INCOMPLETE', compact: 'ROUTER_COMPACT_ID_INVALID', server: 'ROUTER_REQUEST_FAILED', network: 'ROUTER_REQUEST_FAILED' }[kind])
  assert.equal(result.usage?.prompt_tokens, ['network', 'server'].includes(kind) ? 10 : 20)
  assert.equal(result.usage?.completion_tokens, attempts.reduce((n: number, a: any) => n + (a.completionTokens ?? 0), 0))
})

test('two failed attempts preserve the last code, detail, total usage and sanitized telemetry', async () => {
  const app = fixture(async function* (_, n) { yield* answer(n === 1 ? 'private broken JSON' : { ...valid, contextId: 'private unknown id' }) })
  await assert.rejects(app.router.decide(input), (error: any) => {
    assert.equal(error.code, 'ROUTER_INVALID_DECISION')
    assert.equal(error.detail, 'unknown-context-id')
    assert.equal(error.meta.attempts.length, 2)
    assert.equal(error.meta.usage.prompt_tokens, 20)
    assert.ok(!JSON.stringify(error).includes('private'))
    return true
  })
})

for (const status of [400, 401, 403, 429]) test(`HTTP ${status} is not retried`, async () => {
  const app = fixture(async function* () { yield { type: 'finish', reason: { kind: 'error', failure: { code: 'TEST_FAILURE', message: 'private', status } } } })
  await assert.rejects(app.router.decide(input), (e: any) => e.meta.httpStatus === status)
  assert.equal(app.requests.length, 1)
  if (status !== 400) {
    await assert.rejects(app.router.decide(input), (e: any) => e.code === 'ROUTER_CIRCUIT_OPEN')
    assert.equal(app.requests.length, 1)
  }
})

test('a thrown HTTP authentication error retains its status and does not retry', async () => {
  const app = fixture(async function* () { throw Object.assign(new Error('private'), { status: 401 }) })
  await assert.rejects(app.router.decide(input), (e: any) => e.meta.httpStatus === 401)
  assert.equal(app.requests.length, 1)
})

test('caller cancellation is propagated without retry or circuit penalty', async () => {
  const controller = new AbortController(), reason = new Error('cancel')
  const app = fixture(async function* (_, n) { if (n === 1) { controller.abort(reason); throw reason } yield* answer(valid) })
  await assert.rejects(app.router.decide(input, controller.signal), e => e === reason)
  assert.equal(app.requests.length, 1)
  assert.equal((await app.router.decide(input)).decision.contextId, 'garden')
})

test('retry uses the remainder of one deadline rather than a fresh timeout', async () => {
  const app = fixture(async function* (options, n) {
    if (n === 1) { await new Promise(r => setTimeout(r, 60)); yield* answer('broken'); return }
    await new Promise(r => setTimeout(r, 65))
    options.signal!.throwIfAborted()
    yield* answer(valid)
  }, 100)
  await assert.rejects(app.router.decide(input), RouterFailure)
  assert.equal(app.requests.length, 2)
  assert.equal(app.requests[0].signal, app.requests[1].signal)
  assert.equal(app.requests[1].signal?.aborted, true)
})

test('an exhausted first attempt cannot start a retry', async () => {
  const app = fixture(async function* () { await new Promise(r => setTimeout(r, 30)); yield* answer('broken') }, 10)
  await assert.rejects(app.router.decide(input), RouterFailure)
  assert.equal(app.requests.length, 1)
})

test('the circuit counts three failed decisions, not their six attempts', async () => {
  let now = 10000
  const app = fixture(async function* () { yield* answer('broken') }, 1000, () => now)
  for (let n = 0; n < 3; n++) { await assert.rejects(app.router.decide(input), (e: any) => e.code === 'ROUTER_INVALID_JSON'); now += 3000 }
  assert.equal(app.requests.length, 6)
  await assert.rejects(app.router.decide(input), (e: any) => e.code === 'ROUTER_CIRCUIT_OPEN')
  assert.equal(app.requests.length, 6)
})

test('decision failures expose bounded rule names', () => {
  for (const [row, detail] of [[null, 'not-object'], [{ ...valid, action: 'bad' }, 'bad-action'], [{ ...valid, reason: '' }, 'bad-reason'], [{ action: 'CREATE', reason: 'new' }, 'missing-title'], [{ ...valid, contextId: 'unknown' }, 'unknown-context-id']])
    assert.throws(() => validateRoutingDecision(row, input), (e: any) => e.detail === detail)
})

test('aside is an optional boolean restricted to CREATE', () => {
  const create = { action: 'CREATE', title: 'Conversion', reason: 'one off' }
  assert.equal((validateRoutingDecision({ ...create, aside: true }, input) as any).aside, true)
  for (const aside of ['true', 1, [], {}]) assert.throws(() => validateRoutingDecision({ ...create, aside }, input), RouterFailure)
  for (const action of ['EXISTING', 'CLARIFY']) for (const aside of [true, false])
    assert.throws(() => validateRoutingDecision({ ...valid, action, question: action === 'CLARIFY' ? 'Which?' : null, aside }, input), (e: any) => e.detail === 'aside-action')
  assert.deepEqual(validateRoutingDecision({ ...create, aside: false }, input), validateRoutingDecision(create, input))
  assert.deepEqual(validateRoutingDecision({ ...valid, aside: null }, input), validateRoutingDecision(valid, input))
})

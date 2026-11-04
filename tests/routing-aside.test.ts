import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { harness, ask, FixtureModel, textResponse } from './harness.ts'
import { ROUTING_PROMPT } from '../src/llm-router.ts'

const A = 'ctx_qwen_9070xt', question = 'Convert 12 km to miles'
async function setup(aside: boolean | undefined, mounted = true, recheckAside = aside, prompt = question) {
  const root = await mkdtemp(join(tmpdir(), 'theone-model-aside-')), model = new FixtureModel()
  const requests: any[] = []
  model.behavior = async function* (options) {
    if (options.system?.startsWith(ROUTING_PROMPT)) {
      const p = JSON.parse(options.messages[0].content.flatMap(b => b.type === 'text' ? b.text : []).join(''))
      requests.push(p)
      yield* textResponse(JSON.stringify(p.text === prompt
        ? { action: 'CREATE', title: 'Distance conversion', reason: 'one question', historyIndependent: true, aside: p.recheck ? recheckAside : aside }
        : { action: 'EXISTING', contextId: A, reason: 'work' }))
    } else yield* textResponse('Done.')
  }
  const app = await harness(root, model, { routerMode: 'llm', theoneConfig: { routingShadow: false } })
  if (mounted) app.ctx.theone.store.mount('test-gateway', A)
  return { ...app, requests, dispose: async () => { await app.close(); await rm(root, { recursive: true, force: true }) } }
}

test('model aside creates a reusable topic and bare continuation returns to the work', async () => {
  const app = await setup(true)
  try {
    const first = await ask(app.gateway, question), store = app.ctx.theone.store
    const route = store.route(first.input.id)!
    assert.equal(route.decision.action, 'CREATE')
    assert.notEqual(route.decision.contextId, A)
    assert.equal(store.routeReceipt(first.input.id)?.temporary?.returnTopicId, A)
    assert.equal(store.current('test-gateway'), A)
    assert.ok(store.contexts().some(c => c.id === route.decision.contextId))
    assert.equal(store.routeReceipt(first.input.id)?.calls, 1)
    assert.equal(store.routeReceipt(first.input.id)?.tier, 'quick')
    assert.deepEqual(store.routeReceipt(first.input.id)?.trace?.recheck, { attempted: false, skipped: 'aside' })
    assert.equal(app.requests.some(p => p.recheck), false)
    const next = await ask(app.gateway, 'continue')
    assert.equal(store.route(next.input.id)?.decision.contextId, A)
    assert.equal(store.routeReceipt(next.input.id)?.calls, 0)
  } finally { await app.dispose() }
})

test('a follow-up to the aside can still use its own topic', async () => {
  const app = await setup(true)
  try {
    const aside = await ask(app.gateway, question)
    const followup = await ask(app.gateway, 'why?')
    assert.equal(app.ctx.theone.store.route(followup.input.id)?.decision.contextId, app.ctx.theone.store.route(aside.input.id)?.decision.contextId)
  } finally { await app.dispose() }
})

test('aside without a current topic is mounted normally and has no temporary return', async () => {
  const app = await setup(true, false)
  try {
    const result = await ask(app.gateway, question), store = app.ctx.theone.store
    assert.equal(store.route(result.input.id)?.decision.aside, true)
    assert.equal(store.routeReceipt(result.input.id)?.temporary, undefined)
    assert.equal(store.routeReceipt(result.input.id)?.calls, 1)
    assert.deepEqual(store.routeReceipt(result.input.id)?.trace?.recheck, { attempted: false, skipped: 'aside' })
    assert.equal(store.current('test-gateway'), store.route(result.input.id)?.decision.contextId)
  } finally { await app.dispose() }
})

for (const aside of [false, undefined]) test(`aside ${aside} keeps normal CREATE mounting`, async () => {
  const app = await setup(aside)
  try {
    const result = await ask(app.gateway, question), store = app.ctx.theone.store
    const id = store.route(result.input.id)?.decision.contextId
    assert.notEqual(id, A)
    assert.equal(store.routeReceipt(result.input.id)?.temporary, undefined)
    assert.equal(store.current('test-gateway'), id)
    assert.equal(store.routeReceipt(result.input.id)?.calls, 2)
    assert.deepEqual(store.routeReceipt(result.input.id)?.trace?.recheck,
      { attempted: true, trigger: 'create', previous: 'CREATE', accepted: true })
    assert.equal(store.route((await ask(app.gateway, 'continue')).input.id)?.decision.contextId, id)
  } finally { await app.dispose() }
})

test('an aside with conflicting evidence is rechecked and the final decision controls the temporary return', async () => {
  const prompt = 'Convert the FP8 figure to miles'
  const app = await setup(true, true, false, prompt)
  try {
    const result = await ask(app.gateway, prompt), store = app.ctx.theone.store
    assert.equal(store.routeReceipt(result.input.id)?.calls, 2)
    assert.equal(store.routeReceipt(result.input.id)?.tier, 'recheck')
    assert.deepEqual(store.routeReceipt(result.input.id)?.trace?.recheck,
      { attempted: true, trigger: 'evidence-conflict', previous: 'CREATE', contextId: A, terms: ['fp8'], accepted: true })
    assert.equal(app.requests.filter(p => p.recheck?.contextId === A).length, 1)
    assert.equal(store.routeReceipt(result.input.id)?.temporary, undefined)
    assert.equal(store.current('test-gateway'), store.route(result.input.id)?.decision.contextId)
  } finally { await app.dispose() }
})

for (const { aside, prompt, calls, conflict } of [
  { aside: true, prompt: question, calls: 1, conflict: false },
  { aside: true, prompt: 'Convert the FP8 figure to miles', calls: 2, conflict: true },
  { aside: false, prompt: question, calls: 2, conflict: false },
  { aside: undefined, prompt: question, calls: 2, conflict: false },
]) test(`running input aside=${aside}, conflict=${conflict} uses ${calls} routing calls and mounts according to aside`, async () => {
  const app = await setup(aside, true, aside, prompt)
  let child: string | undefined
  const original = app.model.behavior!
  app.model.behavior = async function* (options) {
    if (!options.system?.startsWith(ROUTING_PROMPT) && !child) {
      child = app.ctx.theone.submitMessage(app.gateway.id, prompt, {}, 'steer').id
      await new Promise(r => setImmediate(r))
    }
    yield* original(options)
  }
  try {
    await ask(app.gateway, 'Qwen work plan')
    await app.gateway.whenIdle()
    assert.ok(child)
    const store = app.ctx.theone.store
    assert.ok(app.requests.some(p => p.text === prompt && p.running?.topicId === A))
    assert.equal(store.route(child)?.status, 'completed')
    assert.equal(store.route(child)?.decision.action, 'CREATE')
    assert.equal(store.routeReceipt(child)?.temporary?.returnTopicId, aside ? A : undefined)
    assert.equal(store.routeReceipt(child)?.calls, calls)
    assert.deepEqual(store.routeReceipt(child)?.trace?.recheck, calls === 1
      ? { attempted: false, skipped: 'aside' }
      : { attempted: true, trigger: conflict ? 'evidence-conflict' : 'create', previous: 'CREATE',
        ...(conflict ? { contextId: A, terms: ['fp8'] } : {}), accepted: true })
    assert.equal(app.requests.filter(p => p.text === prompt).length, calls)
    const mounted = aside ? A : store.route(child)?.decision.contextId
    assert.equal(store.current('test-gateway'), mounted)
    assert.equal(store.route((await ask(app.gateway, 'continue')).input.id)?.decision.contextId, mounted)
  } finally { await app.dispose() }
})

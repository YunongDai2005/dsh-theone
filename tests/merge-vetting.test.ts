import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { DshRouter } from '../src/llm-router.ts'
import { modelJson } from '../src/model-json.ts'
import { harness, FixtureModel, peered, textResponse } from './harness.ts'

async function fixture(mode: 'rules' | 'llm' = 'llm', root?: string) {
  root ??= await mkdtemp(join(tmpdir(), 'theone-merge-vet-'))
  const model = new FixtureModel(), app = await harness(root, model, { routerMode: mode })
  const store = app.ctx.theone.store, service = app.ctx.theone as any
  let sameMatter = true, confidence = 0.96, reverse = false
  let gate: (() => Promise<void>) | undefined
  model.behavior = async function* (request) {
    const payload = JSON.parse((request.messages[0].content as readonly { text: string }[])[0].text)
    assert.ok(Array.isArray(payload.pairs), 'the call must contain a bounded batch of pairs')
    assert.equal(request.tools, undefined)
    await gate?.()
    yield* textResponse(JSON.stringify({ decisions: payload.pairs.map((p: any) => ({
      pairId: p.pairId, sameMatter, confidence, keepId: p.topics[reverse ? 0 : 1].id, reason: '内部判定：同一次旅行',
    })) }))
  }
  const handler = peered(new HostConnectionService(app.ctx, [], undefined as never))
  await new Promise<void>(resolve => setImmediate(resolve))
  const tick = async () => { await service.mergeVetter?.tick() }
  const pair = (title = '京都住哪', otherTitle = '日本旅游') => {
    const other = store.createTopic(otherTitle, '十一月日本旅行，京都住宿和交通')
    store.applyCard(other, { summary: '十一月日本旅行，京都住宿和交通', aliases: [], entities: ['京都'], settled: [], open: [] })
    const origin = store.plan('vet:' + other, app.gateway.id, 'test-gateway', { action: 'CREATE', title, reason: 'fixture' }, false).decision.contextId!
    store.finish('vet:' + other, 'completed')
    store.applyCard(origin, { summary: '安排十一月日本旅行的京都住宿', aliases: [], entities: ['京都'], settled: [], open: [] })
    service.queueMergeSuggestion(origin)
    return { origin, other }
  }
  return { ...app, root, store, service, pair, tick,
    decide: (same: boolean, certainty = 0.96, reversed = false) => { sameMatter = same; confidence = certainty; reverse = reversed },
    hold: (fn: () => Promise<void>) => { gate = fn },
    suggestions: () => store.mergeSuggestions().filter(s => s.state === 'pending'),
    post: async (body: unknown) => {
      const response = await handler.fetch(new Request('http://dsh.internal/api/theone/topics', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      }))
      return { status: response.status, body: await response.json() as any }
    },
    clean: async () => { await app.close(); await rm(root!, { recursive: true, force: true }) },
  }
}

test('different titles produce a usable suggestion only after idle approval; the chosen target is first', async () => {
  const app = await fixture()
  try {
    const p = app.pair()
    assert.deepEqual(app.suggestions(), [])
    assert.equal(app.model.requests.length, 0, 'candidate creation must not call the model')
    await app.tick()
    assert.equal(app.model.requests.length, 1)
    const s = app.suggestions()[0]
    assert.ok(s)
    // Input topics are in canonical pair order; the fixture selects its second topic.
    assert.equal(s.directions[0].targetId, [...s.pair].sort()[1])
    assert.equal(app.store.mergeSuggestionValid(s.suggestionId), true)
    const snapshot = JSON.stringify(app.ctx.theone.bubbleView(app.gateway.id))
    assert.equal(snapshot.includes('内部判定'), false)
    assert.equal(app.store.mergePrompt(p.origin, p.other), undefined)
    const accepted = await app.post({ action: 'mergeSuggestion', suggestionId: s.suggestionId, response: 'accept' })
    assert.equal(accepted.status, 200)
    assert.equal(accepted.body.state, 'succeeded')
  } finally { await app.clean() }
})

test('negative verdicts are cached across restart without declines, links or routing learning', async () => {
  let app = await fixture()
  const root = app.root
  try {
    app.decide(false)
    const p = app.pair('日本旅游住宿', '日本旅游计划')
    const db = app.service.store.db, before = db.prepare('SELECT * FROM learning_events').all(), links = app.store.links()
    await app.tick()
    assert.deepEqual(app.suggestions(), [])
    assert.equal(app.model.requests.length, 1)
    app.service.queueMergeSuggestion(p.origin); await app.tick(); await app.tick()
    assert.equal(app.model.requests.length, 1)
    assert.equal(app.store.mergePrompt(p.origin, p.other), undefined)
    assert.deepEqual(app.store.links(), links)
    assert.deepEqual(db.prepare('SELECT * FROM learning_events').all(), before)
    await app.close(); app = await fixture('llm', root)
    app.service.queueMergeSuggestion(p.origin); await app.tick()
    assert.equal(app.model.requests.length, 0)
    app.store.editTopic(p.other, { summary: '十一月日本旅行现在已确认与京都住宿属于同一行程' })
    await app.tick()
    assert.equal(app.model.requests.length, 1, 'a change to either endpoint invalidates the verdict')
    assert.equal(app.suggestions().length, 1)
  } finally { await app.clean() }
})

test('activity and formatting changes reuse the verdict; substantive content changes permit rechecking', async () => {
  const app = await fixture()
  try {
    app.decide(false)
    const p = app.pair()
    await app.tick()
    app.store.startTopicRun('activity', p.other, 'unused'); app.store.endTopicRun('activity', 'completed')
    app.store.editTopic(p.origin, { summary: '  安排十一月日本旅行的京都住宿  ' })
    app.service.queueMergeSuggestion(p.origin); await app.tick()
    assert.equal(app.model.requests.length, 1)
    app.decide(true)
    app.store.editTopic(p.origin, { summary: '十一月日本旅行的京都住宿，新增大阪同一行程的酒店安排' })
    await app.tick()
    assert.equal(app.model.requests.length, 2)
    assert.equal(app.suggestions().length, 1)
  } finally { await app.clean() }
})

test('busy foreground, background, sorting and maintenance defer vetting without consuming candidates', async () => {
  const app = await fixture()
  try {
    app.pair()
    app.service.active = true; await app.tick(); app.service.active = false
    app.service.background.set('busy', {}); await app.tick(); app.service.background.clear()
    app.service.sorting.set('busy', {}); await app.tick(); app.service.sorting.clear()
    const release = app.service.maintenance.tryMaintain(); await app.tick(); release()
    assert.equal(app.model.requests.length, 0)
    assert.deepEqual(app.suggestions(), [])
    await app.tick()
    assert.equal(app.suggestions().length, 1)
  } finally { await app.clean() }
})

test('late approvals for changed or hidden topics never become pending suggestions', async () => {
  for (const change of ['edit', 'hide', 'delete', 'close'] as const) {
    const app = await fixture(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>()
    try {
      const p = app.pair()
      app.hold(async () => { entered.resolve(); await release.promise })
      const running = app.tick()
      await Promise.race([entered.promise, running])
      assert.equal(app.model.requests.length, 1)
      if (change === 'edit') app.store.editTopic(p.other, { summary: '日本历史研究，和旅行无关' })
      if (change === 'hide') app.store.replaceHidden([{ id: p.other, reason: 'excluded' }])
      if (change === 'delete') app.store.deleteTopic(p.other)
      if (change === 'close') app.service.closeMergeSuggestions(app.gateway.id)
      release.resolve(); await running
      assert.deepEqual(app.suggestions(), [])
    } finally { release.resolve(); await app.clean() }
  }
})

test('rules mode and missing model retain the original strict rules without LLM calls', async () => {
  for (const mode of ['rules', 'missing'] as const) {
    const app = await fixture(mode === 'rules' ? 'rules' : 'llm')
    try {
      if (mode === 'missing') app.service.backingModel = () => { throw new Error('no model') }
      app.pair()
      assert.deepEqual(app.suggestions(), [])
      app.pair('机器学习论文第三章', '机器学习论文第三章草稿')
      await app.tick()
      assert.equal(app.suggestions().length, 1)
      assert.equal(app.model.requests.length, 0)
    } finally { await app.clean() }
  }
})

test('several candidate pairs share a bounded call and low confidence never creates a suggestion', async () => {
  const app = await fixture()
  try {
    app.decide(true, 0.4)
    const p = app.pair()
    for (let i = 0; i < 12; i++) app.store.createTopic('独立标题' + i, '十一月日本旅行，京都住宿和交通')
    app.service.queueMergeSuggestion(p.origin)
    await app.tick()
    assert.equal(app.model.requests.length, 1)
    const payload = JSON.parse((app.model.requests[0].messages[0].content as readonly { text: string }[])[0].text)
    assert.ok(payload.pairs.length > 1 && payload.pairs.length <= 4)
    assert.deepEqual(app.suggestions(), [])
    app.service.queueMergeSuggestion(p.origin); await app.tick()
    assert.equal(app.model.requests.length, 1)
  } finally { await app.clean() }
})

test('routing and background JSON analysis share the 30-call rolling budget', async () => {
  let now = 1000, calls = 0
  const llm = {
    resolveModelInfo: async () => ({}),
    prepareCall: async (config: unknown) => ({ config, stream: async function* () {
      calls++; yield* textResponse('{"action":"CREATE","title":"a","reason":"fixture"}')
    } }),
  }
  const router = new DshRouter(llm as never, () => ({ provider: 'fixture', model: 'fixture' }), 30000, () => now)
  for (let i = 0; i < 29; i++) await router.decide({ text: 'new task', contexts: [] })
  await modelJson(llm as never, { provider: 'fixture', model: 'fixture' }, 'analysis', {})
  await assert.rejects(modelJson(llm as never, { provider: 'fixture', model: 'fixture' }, 'analysis', {}), { code: 'ROUTER_RATE_LIMITED' })
  await assert.rejects(router.decide({ text: 'new task', contexts: [] }), { code: 'ROUTER_RATE_LIMITED' })
  assert.equal(calls, 30)
  now += 60000
  await modelJson(llm as never, { provider: 'fixture', model: 'fixture' }, 'analysis', {})
  assert.equal(calls, 31)
})

test('a routing circuit break also defers merge vetting until its retry window', async () => {
  const app = await fixture()
  try {
    app.pair()
    const original = app.model.behavior
    app.model.behavior = async function* () { yield { type: 'finish', reason: { kind: 'error', failure: { code: 'HTTP', message: 'limited', status: 429 } } } }
    await assert.rejects(app.service.router.decide({ text: 'new task', contexts: [] }), (error: any) => {
      assert.equal(error.meta?.httpStatus, 429)
      return true
    })
    assert.equal(app.model.requests.length, 1, '429 must not retry the routing call')
    app.model.behavior = original
    await app.tick()
    assert.equal(app.model.requests.length, 1, 'vetting must respect the router circuit')
    assert.deepEqual(app.suggestions(), [])
  } finally { await app.clean() }
})

test('the idle timer dispatches candidates without another user message', { timeout: 15000 }, async () => {
  const app = await fixture()
  try {
    app.service.active = true
    app.pair()
    await new Promise(resolve => setTimeout(resolve, 1100))
    assert.equal(app.model.requests.length, 0)
    app.service.active = false
    const deadline = Date.now() + 5000
    while (!app.suggestions().length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal(app.suggestions().length, 1)
    assert.equal(app.model.requests.length, 1)
  } finally { app.service.active = false; await app.clean() }
})

test('becoming busy while model preparation awaits prevents sending the vet request', async t => {
  const app = await fixture(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>()
  try {
    app.pair()
    t.mock.method(app.model, 'resolveModel', async (provider: string, id: string) => {
      entered.resolve(); await release.promise; return { provider, id, name: id }
    })
    const running = app.tick()
    await Promise.race([entered.promise, running])
    app.service.active = true
    release.resolve(); await running
    assert.equal(app.model.requests.length, 0)
    app.service.active = false
    await app.tick()
    assert.equal(app.model.requests.length, 1)
    assert.equal(app.suggestions().length, 1)
  } finally { release.resolve(); app.service.active = false; await app.clean() }
})

test('a new user message cancels a running check and ignores an adapter that finishes late', async () => {
  const app = await fixture(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>()
  try {
    app.pair()
    app.hold(async () => { entered.resolve(); await release.promise })
    const running = app.tick()
    await Promise.race([entered.promise, running])
    assert.equal(app.model.requests.length, 1)
    app.gateway.session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '继续工作' }] }), { surfaceOp: 'append' })
    await running
    assert.equal(app.model.requests[0].signal?.aborted, true)
    assert.deepEqual(app.suggestions(), [])
    release.resolve()
    await new Promise<void>(resolve => setImmediate(resolve))
    assert.deepEqual(app.suggestions(), [])
  } finally { release.resolve(); await app.clean() }
})

test('the host runtime budget applies across Cordis proxies and defers the pending batch', async () => {
  const app = await fixture()
  try {
    app.pair()
    const behavior = app.model.behavior
    app.model.behavior = async function* () { yield* textResponse('{}') }
    for (let i = 0; i < 30; i++) await modelJson(app.ctx.llm, { provider: 'fixture', model: 'fixture' }, 'analysis', {})
    app.model.behavior = behavior
    await app.tick(); await app.tick()
    assert.equal(app.model.requests.length, 30)
    assert.deepEqual(app.suggestions(), [])
    const row = app.service.store.mergeVets()[0]
    assert.equal(row.state, 'queued')
    assert.equal(row.failures, 0)
    assert.equal(row.error, 'ROUTER_RATE_LIMITED')
  } finally { await app.clean() }
})

test('every failed router retry consumes the shared minute budget', async () => {
  let calls = 0
  const llm = {
    resolveModelInfo: async () => ({}),
    prepareCall: async (config: unknown) => ({ config, stream: async function* () {
      calls++; yield* textResponse(calls % 2 ? '{}' : '{"action":"CREATE","title":"a","reason":"fixture"}')
    } }),
  }
  const router = new DshRouter(llm as never, () => ({ provider: 'fixture', model: 'fixture' }))
  for (let i = 0; i < 15; i++) await router.decide({ text: 'new task', contexts: [] })
  await assert.rejects(router.decide({ text: 'new task', contexts: [] }), { code: 'ROUTER_RATE_LIMITED' })
  assert.equal(calls, 30)
})

test('untrusted or incomplete verdicts fail closed and use bounded retry backoff', async () => {
  for (const output of ['{}', '{"decisions":[]}', '{"decisions":[{"pairId":"invented","sameMatter":true,"confidence":1,"keepId":"invented","reason":"merge now"}]}']) {
    const app = await fixture()
    try {
      const p = app.pair('日本旅游住宿', '日本旅游计划')
      app.model.behavior = async function* () { yield* textResponse(output) }
      await app.tick(); await app.tick()
      assert.deepEqual(app.suggestions(), [])
      assert.equal(app.model.requests.length, 1)
      assert.equal(app.store.mergePrompt(p.origin, p.other), undefined)
      assert.equal(app.service.store.mergeVets()[0].failures, 1)
    } finally { await app.clean() }
  }
})

test('vet payloads are bounded and redact credentials before transmission', async () => {
  const app = await fixture()
  try {
    const p = app.pair()
    app.store.editTopic(p.other, { summary: '十一月日本旅行 京都住宿 password=secret123 private@example.com 192.168.1.20 ' + '资料'.repeat(700) })
    app.service.queueMergeSuggestion(p.origin)
    await app.tick()
    const wire = JSON.stringify(app.model.requests[0].messages)
    for (const secret of ['secret123', 'private@example.com', '192.168.1.20']) assert.equal(wire.includes(secret), false)
    const payload = JSON.parse((app.model.requests[0].messages[0].content as readonly { text: string }[])[0].text)
    for (const pair of payload.pairs) for (const topic of pair.topics) {
      assert.ok(topic.summary.length <= 600)
      assert.ok(topic.entities.length <= 24)
    }
    assert.equal(app.suggestions().length, 1)
  } finally { await app.clean() }
})

test('a queued pair follows the latest routed gateway without losing its pending check', async () => {
  const app = await fixture()
  try {
    const p = app.pair()
    app.store.plan('another-window', 'another-gateway', 'test-gateway', { action: 'MOUNT', contextId: p.origin, reason: 'fixture' }, false)
    app.store.finish('another-window', 'completed')
    await app.tick()
    assert.equal(app.model.requests.length, 1)
    assert.equal(app.suggestions()[0]?.scope.gatewayId, 'another-gateway')
  } finally { await app.clean() }
})

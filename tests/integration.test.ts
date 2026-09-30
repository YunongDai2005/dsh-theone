import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { SessionId } from '@deepseek-ai/dsh-session'
import { randomUUID } from 'node:crypto'
import { harness, ask, FixtureModel, textResponse } from './harness.ts'

test('Gateway is advertised in the DSH model catalog used by Web selection',async()=>{
  const root=await mkdtemp(join(tmpdir(),'theone-catalog-'))
  const app=await harness(root)
  try {
    assert.deepEqual(await app.ctx.llm.listModels('theone'),[{provider:'theone',id:'gateway',name:'TheOne 主聊天',inputModalities:['text']}])
    assert.ok(app.ctx.llm.listProviders().some(provider=>provider.id==='theone' && provider.name==='TheOne'))
  } finally {await app.close();await rm(root,{recursive:true,force:true})}
})

test('unclear input asks for clarification without a worker; CREATE survives reopen', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-create-'))
  let app = await harness(root)
  try {
    const unclear = await ask(app.gateway, '继续昨天那个')
    assert.match(unclear.output, /哪个话题/)
    assert.equal(app.model.requests.length, 0)
    assert.equal(app.ctx.theone.store.contexts().length, 2)
    const created = await ask(app.gateway, '新话题：学习日语')
    assert.equal(created.end?.data.reason.kind, 'completed')
    const record = app.ctx.theone.store.route(created.input.id)!
    assert.equal(record.decision.action, 'CREATE')
    assert.equal(app.ctx.theone.store.contexts().length, 3)
    await app.close()
    app = await harness(root)
    assert.equal(app.ctx.theone.store.contexts().length, 3)
    assert.equal(app.ctx.theone.store.route(created.input.id)?.status, 'completed')
    assert.throws(() => app.ctx.theone.store.claim(created.input.id), /already started/)
    const continued = await ask(app.gateway, '继续')
    assert.equal(continued.output, `模拟回答：${record.decision.contextId}`)
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('worker failure reaches gateway and does not turn into successful output', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-failure-'))
  const model = new FixtureModel()
  model.behavior = async function* () { throw new Error('fixture provider failure') }
  const app = await harness(root, model)
  try {
    const result = await ask(app.gateway, 'Qwen 那个')
    assert.equal(result.end?.data.reason.kind, 'error')
    assert.equal(result.output, '')
    assert.equal(app.ctx.theone.store.route(result.input.id)?.status, 'failed')
    assert.equal(model.requests.length, 1)
    model.behavior = undefined
    assert.equal((await ask(app.gateway, '继续')).end?.data.reason.kind, 'completed')
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('gateway cancellation cancels the worker and releases admission', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-cancel-'))
  const entered = Promise.withResolvers<void>()
  let cancelled = false
  const model = new FixtureModel()
  model.behavior = async function* (options) {
    entered.resolve()
    await new Promise<void>(resolve => {
      const abort = () => { cancelled = true; resolve() }
      if (options.signal?.aborted) abort()
      else options.signal?.addEventListener('abort', abort, { once: true })
    })
    options.signal?.throwIfAborted()
  }
  const app = await harness(root, model)
  try {
    const pending = ask(app.gateway, 'Qwen 那个')
    await entered.promise
    const another = (await app.ctx.agents.create({ sessionId: SessionId(randomUUID()), agentOptions: { provider: 'theone', model: 'gateway' } })).agent
    const competing = await ask(another, '论文那个')
    assert.equal(competing.end?.data.reason.kind, 'error')
    assert.equal(app.ctx.theone.store.current('test-gateway'), 'ctx_qwen_9070xt')
    app.gateway.cancel({ kind: 'user' })
    const result = await pending
    assert.equal(result.end?.data.reason.kind, 'aborted')
    assert.equal(cancelled, true)
    const workerId = app.ctx.theone.store.contexts().find(context => context.id === 'ctx_qwen_9070xt')!.workingSessionId
    assert.equal(app.ctx.agents.get(SessionId(workerId))?.status, 'idle')
    assert.equal(app.ctx.theone.store.route(result.input.id)?.status, 'failed')
    model.behavior = undefined
    assert.equal((await ask(app.gateway, '继续')).end?.data.reason.kind, 'completed')
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('tool calls run once in the worker; history search stays in its Context', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-tools-'))
  const app = await harness(root)
  let calls = 0
  try {
    app.ctx.tools.register(defineTool({
      name: 'fixture_counter', description: 'Count one test invocation.', parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value: string) => [{ type: 'text', text: value }] },
      execute: async () => { calls++; return 'tunable_marker' },
    }))
    app.model.behavior = async function* () {
      if (calls === 0) {
        const id = ToolCallId('fixture-call')
        yield { type: 'block-start', index: 0, blockType: 'tool-call' }
        yield { type: 'tool-call-delta', index: 0, id, name: 'fixture_counter', argumentsDelta: '{}' }
        yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'fixture_counter', arguments: '{}' } }
        yield { type: 'finish', reason: { kind: 'tool-calls' } }
      } else yield* textResponse('tunable_marker: complete')
    }
    const result = await ask(app.gateway, 'Qwen 那个')
    assert.equal(result.end?.data.reason.kind, 'completed', JSON.stringify(result.end))
    assert.equal(calls, 1)
    assert.equal(result.output, 'tunable_marker: complete')
    assert.ok(!result.events.some(event => event.type === 'tool/call'))
    const route = app.ctx.theone.store.route(result.input.id)!
    assert.equal(route.status, 'completed')
    const windows = await app.ctx.theone.searchHistory('ctx_qwen_9070xt', 'tunable_marker')
    assert.ok(windows.length > 0)
    assert.deepEqual(await app.ctx.theone.searchHistory('ctx_thesis', 'tunable_marker'), [])
    assert.equal(app.model.requests.length, 2)
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('Unicode retrieval isolates broken sources and clips both range boundaries', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-history-'))
  const model = new FixtureModel()
  model.behavior = async function* () { yield* textResponse('企业微信混排 laya测试 cockpit功能') }
  const app = await harness(root, model)
  try {
    await ask(app.gateway, 'Qwen 那个')
    const source = app.ctx.theone.store.contexts().find(context => context.id === 'ctx_qwen_9070xt')!.workingSessionId
    const hits = await app.ctx.sessionQuery.filterEvents(SessionId(source), [{ kind: 'type', values: ['assistant/message'] }])
    const seq = hits[0].seq
    assert.throws(() => app.ctx.theone.store.addSource('ctx_thesis', source), /explicit event range/)
    app.ctx.theone.store.addSource('ctx_thesis', 'missing-session', { startSeq: 0, endSeq: 1 })
    app.ctx.theone.store.addSource('ctx_thesis', source, { startSeq: seq, endSeq: seq })
    app.ctx.theone.store.addSource('ctx_thesis', source, { startSeq: seq - 1, endSeq: seq - 1 })
    const readSession = app.ctx.sessionQuery.readSession.bind(app.ctx.sessionQuery)
    let reads = 0
    app.ctx.sessionQuery.readSession = (...args: Parameters<typeof readSession>) => {
      if (args[0] === source) reads++
      return readSession(...args)
    }
    for (const query of ['企业微信', 'LAYA', 'cockpit']) {
      const result = await app.ctx.theone.searchHistoryDetailed('ctx_thesis', query)
      assert.equal(result.partial, true)
      assert.equal(result.failures.length, 1)
      assert.equal(result.failures[0].sessionId, 'missing-session')
      assert.equal(result.windows.length, 1)
      assert.equal(result.windows[0].target.seq, seq)
      assert.deepEqual(result.windows[0].events.map(event => event.seq), [seq])
      assert.equal(result.windows[0].startSeq, seq)
      assert.equal(result.windows[0].endSeq, seq)
    }
    assert.equal(reads, 3, 'multiple ranges must reuse one Session observation per query')
    assert.deepEqual(await app.ctx.theone.searchHistory('ctx_thesis', 'Qwen'), [])
    await assert.rejects(app.ctx.theone.searchHistory('ctx_thesis', '   '), /query/)
    await assert.rejects(app.ctx.theone.searchHistory('unknown', 'laya'), /Unknown/)
    await app.close()
    const reopened = await harness(root)
    try {
      const result = await reopened.ctx.theone.searchHistoryDetailed('ctx_thesis', '企业微信')
      assert.equal(result.windows[0].target.seq, seq)
      assert.equal(result.partial, true)
    } finally { await reopened.close() }
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

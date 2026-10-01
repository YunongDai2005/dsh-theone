import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import { ContextStore } from '../src/store.ts'
import { HistoryCatalog, CATALOG_PROMPT, historyParts, validateCatalog } from '../src/history-catalog.ts'
import { ROUTING_PROMPT, RouterFailure } from '../src/llm-router.ts'
import { harness, ask, FixtureModel, textResponse } from './harness.ts'

test('native catalog routes use buffered HTTP reads, validate mounts and withdraw on disposal', async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-catalog-http-'))
  const app = await harness(root)
  // Already-authenticated dispatch: the test covers the native registry and body bridge contract.
  const connection = new HostConnectionService(app.ctx, [], undefined as never)
  const handler = connection.createSharedFetchHandler('/api')
  try {
    await new Promise<void>(resolve => setImmediate(resolve))
    const url = new URL('http://dsh.internal/api/theone/catalog')
    assert.equal(handler.requestBodyMode({ method: 'GET', url }), 'buffered')
    const response = await handler.fetch(new Request(url))
    assert.equal(response.status, 200)
    const snapshot = await response.json()
    assert.equal(snapshot.contexts.length, app.ctx.theone.store.contexts().length)
    const mount = (contextId: string) => handler.fetch(new Request('http://dsh.internal/api/theone/context/mount', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ contextId }),
    }))
    assert.equal((await mount('missing')).status, 400)
    const topic = app.ctx.theone.store.contexts()[0]
    assert.equal((await mount(topic.id)).status, 200)
    assert.equal(app.ctx.theone.store.current('test-gateway'), topic.id)
    assert.equal((await handler.fetch(new Request('http://dsh.internal/api/theone/catalog/refresh', { method: 'POST' }))).status, 409)
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
  assert.equal((await handler.fetch(new Request('http://dsh.internal/api/theone/catalog'))).status, 404)
})

function fixture() {
  const model = new FixtureModel()
  model.behavior = async function* (options) {
    if (options.system === CATALOG_PROMPT) {
      assert.ok((options.maxTokens ?? 0) >= 8192)
      assert.equal(options.tools, undefined)
      assert.equal(options.sessionId, undefined)
      const payload = JSON.parse(options.messages[0].content.filter(b => b.type === 'text').map(b => b.text).join(''))
      assert.ok(!JSON.stringify(payload).includes('sk-syntheticprivate1234567890'))
      const sets = new Map<string, number[]>()
      for (const turn of payload.turns) {
        const title = turn.text.includes('显卡') ? '显卡部署' : turn.text.includes('实验') ? '论文实验' : '论文方法'
        sets.set(title, [...sets.get(title) ?? [], turn.seq])
      }
      yield* textResponse(JSON.stringify({ topics: [...sets].map(([title, turns]) => {
        const context = payload.contexts.find((c: { id: string; title: string }) => payload.ownedContextId ? c.id === payload.ownedContextId : c.title === title)
        const groupTitle = title === '显卡部署' ? '模型部署' : '论文研究'
        const group = payload.groups.find((g: { title: string }) => g.title === groupTitle)
        return { contextId: context?.id ?? null, title, summary: title + '的历史资料', entities: [title], keywords: [title], lastState: '正在处理', turns,
          groupId: group?.id ?? null, groupTitle: group ? null : groupTitle, groupSummary: groupTitle + '相关事项' }
      }) }))
    } else if (options.system === ROUTING_PROMPT) {
      const payload = JSON.parse(options.messages[0].content.filter(b => b.type === 'text').map(b => b.text).join(''))
      const found = payload.contexts.find((c: { title: string }) => c.title === '论文方法')
      yield* textResponse(JSON.stringify({ action: 'EXISTING', contextId: found.id, title: null, question: null, reason: '继续论文方法' }))
    } else yield* textResponse('测试回答')
  }
  return model
}

async function source(app: Awaited<ReturnType<typeof harness>>, root: string, ...messages: string[]) {
  const handle = await app.ctx.agents.create({ sessionId: SessionId(randomUUID()), meta: { cwd: root }, agentOptions: { provider: 'fixture', model: 'fixture' } })
  for (const message of messages) assert.equal((await ask(handle.agent, message)).end?.data.reason.kind, 'completed')
  return handle.agent
}

test('catalog incrementally indexes DSH histories, splits mixed sessions and groups related independent topics', { timeout: 60000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-catalog-'))
  const model = fixture()
  let app = await harness(root, model, { routerMode: 'llm', routerTransport: 'dsh' })
  let catalog = new HistoryCatalog(app.ctx, app.ctx.theone.store, () => ({ provider: 'fixture', model: 'fixture' }))
  try {
    const mixed = await source(app, root, '论文方法：视频注意力设计 sk-syntheticprivate1234567890', '显卡部署：配置 Qwen')
    const experiments = await source(app, root, '论文实验：比较视频注意力实验')
    const original = JSON.stringify(mixed.session.snapshotEvents())
    await catalog.refresh()
    assert.equal(JSON.stringify(mixed.session.snapshotEvents()), original)
    let snapshot = catalog.snapshot()
    const imported = snapshot.contexts.filter(c => ['论文方法', '论文实验', '显卡部署'].includes(c.title))
    assert.equal(imported.length, 3)
    const group = snapshot.groups.find(g => g.title === '论文研究')!
    assert.equal(group.contextIds.length, 2)
    assert.equal(snapshot.groups.find(g => g.title === '模型部署')!.contextIds.length, 1)
    const paper = imported.find(c => c.title === '论文方法')!
    const gpu = imported.find(c => c.title === '显卡部署')!
    assert.equal(app.ctx.theone.store.origin(paper.id)?.cwd, root)
    assert.notEqual(paper.workingSessionId, mixed.id)
    const paperRanges = app.ctx.theone.store.sourceRanges(paper.id)
    const gpuRanges = app.ctx.theone.store.sourceRanges(gpu.id)
    assert.equal(paperRanges.length, 1); assert.equal(gpuRanges.length, 1)
    assert.ok(paperRanges[0].kind === 'bounded' && gpuRanges[0].kind === 'bounded' && paperRanges[0].endSeq < gpuRanges[0].startSeq)
    const calls = model.requests.filter(r => r.system === CATALOG_PROMPT).length
    await catalog.refresh()
    assert.equal(model.requests.filter(r => r.system === CATALOG_PROMPT).length, calls)
    await ask(experiments, '论文实验：增加对照实验')
    await catalog.refresh()
    assert.equal(catalog.snapshot().contexts.filter(c => c.title === '论文实验').length, 1)
    assert.equal(catalog.snapshot().groups.find(g => g.title === '论文研究')!.contextIds.length, 2)
    await catalog.close(); await app.close()
    app = await harness(root, model, { routerMode: 'llm', routerTransport: 'dsh' })
    catalog = new HistoryCatalog(app.ctx, app.ctx.theone.store, () => ({ provider: 'fixture', model: 'fixture' }))
    await catalog.refresh()
    snapshot = catalog.snapshot()
    assert.equal(snapshot.contexts.find(c => c.title === '论文方法')!.id, paper.id)
    assert.equal(snapshot.groups.find(g => g.title === '论文研究')!.id, group.id)
    app.ctx.theone.store.mount('test-gateway', paper.id)
    const continued = await ask(app.gateway, '继续论文方法')
    assert.equal(continued.end?.data.reason.kind, 'completed')
    assert.equal(app.ctx.theone.store.route(continued.input.id)?.decision.action, 'KEEP')
    assert.equal(app.ctx.agents.get(SessionId(paper.workingSessionId))?.session.header.cwd, root)
  } finally { await catalog.close(); await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('catalog validates every turn and rejects unknown references before any write', () => {
  const parts = [{ seq: 10, endSeq: 20, text: '参考', fingerprint: 'a' }]
  const row = { contextId: null, title: '论文', summary: '写作', entities: [], keywords: [], lastState: '进行中', turns: [10], groupId: null, groupTitle: '研究', groupSummary: '' }
  assert.equal(validateCatalog({ topics: [row] }, parts, [], []).length, 1)
  assert.equal(validateCatalog({ topics: [{ ...row, groupSummary: null }] }, parts, [], [])[0].groupSummary, '')
  assert.equal(validateCatalog({ topics: [{ ...row, groupSummary: undefined }] }, parts, [], [])[0].groupSummary, '')
  assert.equal(validateCatalog({ topics: [{ ...row, groupSummary: 'x'.repeat(300) }] }, parts, [], [])[0].groupSummary.length, 200)
  for (const value of [
    { topics: [{ ...row, contextId: 'invented' }] }, { topics: [{ ...row, groupId: 'invented', groupTitle: null }] },
    { topics: [{ ...row, turns: [11] }] }, { topics: [{ ...row, turns: [] }] },
    { topics: [row, row] }, { topics: [{ ...row, summary: 'x'.repeat(801) }] },
    { topics: [{ ...row, groupSummary: 42 }] },
  ]) assert.throws(() => validateCatalog(value, parts, [], []), RouterFailure)
  assert.throws(() => validateCatalog({ topics: [row] }, parts, ['owned'], [], 'owned'), RouterFailure)
})

test('catalog only reuses successful compaction summaries and leaves full historical answers out of compressed input', () => {
  const events = [
    { seq: 0, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '论文方法' }] } },
    { seq: 1, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'FULL_OLD_ANSWER' }] } } },
    { seq: 2, type: 'compaction/summary', data: { compactionId: 'good', shadowedSeqs: [0, 1], summary: [{ type: 'text', text: '已完成的摘要 sk-syntheticprivate1234567890' }] } },
    { seq: 3, type: 'compaction/end', data: { compactionId: 'good' } },
    { seq: 4, type: 'compaction/summary', data: { compactionId: 'bad', shadowedSeqs: [0], summary: [{ type: 'text', text: 'FAILED_SUMMARY' }] } },
    { seq: 5, type: 'compaction/end', data: { compactionId: 'bad', error: 'failed' } },
  ] as unknown as SessionEvent[]
  const result = historyParts(events)
  assert.equal(result.summaries.length, 1)
  assert.ok(!JSON.stringify(result).includes('sk-syntheticprivate1234567890'))
  assert.ok(!JSON.stringify(result).includes('FAILED_SUMMARY'))
  assert.ok(!result.parts[0].text.includes('FULL_OLD_ANSWER'))
  assert.equal(result.parts[0].seq, 0); assert.equal(result.parts[0].endSeq, 5)
})

test('one unreadable history is isolated and invalid model output cannot create catalog records', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-catalog-error-'))
  const model = fixture()
  const app = await harness(root, model)
  const catalog = new HistoryCatalog(app.ctx, app.ctx.theone.store, () => ({ provider: 'fixture', model: 'fixture' }))
  try {
    const good = await source(app, root, '论文方法：测试资料')
    const bad = await source(app, root, '显卡部署：坏的来源')
    const read = app.ctx.sessionQuery.readSession.bind(app.ctx.sessionQuery)
    app.ctx.sessionQuery.readSession = async id => { if (id === bad.id) throw new Error('private error'); return read(id) }
    await catalog.refresh()
    assert.ok(app.ctx.theone.store.contexts().some(c => c.title === '论文方法'))
    assert.ok(!app.ctx.theone.store.contexts().some(c => c.title === '显卡部署'))
    assert.equal(catalog.snapshot().status.failed, 1)
    assert.equal(catalog.incomplete, true)
    await ask(good, '论文实验：新的资料')
    model.behavior = async function* (options) { if (options.system === CATALOG_PROMPT) yield* textResponse('{"topics":[]}'); else yield* textResponse('测试回答') }
    const before = JSON.stringify(app.ctx.theone.store.groups())
    await catalog.refresh()
    assert.equal(JSON.stringify(app.ctx.theone.store.groups()), before)
    assert.ok(!app.ctx.theone.store.contexts().some(c => c.title === '论文实验'))
  } finally { await catalog.close(); await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('catalog cancellation does not commit a partially generated descriptor', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-catalog-cancel-'))
  const model = fixture()
  const app = await harness(root, model)
  const catalog = new HistoryCatalog(app.ctx, app.ctx.theone.store, () => ({ provider: 'fixture', model: 'fixture' }))
  try {
    await source(app, root, '论文方法：取消测试')
    let entered!: () => void
    const started = new Promise<void>(resolve => { entered = resolve })
    model.behavior = async function* (options) {
      entered()
      await new Promise<void>(resolve => options.signal!.addEventListener('abort', () => resolve(), { once: true }))
      options.signal!.throwIfAborted()
    }
    const running = catalog.refresh()
    await started; await catalog.close(); await assert.rejects(running)
    assert.equal(app.ctx.theone.store.groups().length, 0)
  } finally { await catalog.close(); await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('related groups remain separate from per-topic working sessions', () => {
  const store = new ContextStore(':memory:')
  try {
    const topic = (title: string, seq: number) => ({ contextId: null, title, summary: title, entities: [], keywords: [], lastState: '待处理', turns: [seq], groupId: null, groupTitle: '论文研究', groupSummary: '相关项目' })
    store.importTopics('source', '/tmp', [{ seq: 0, endSeq: 4, text: '', fingerprint: 'a' }, { seq: 5, endSeq: 8, text: '', fingerprint: 'b' }], [topic('方法设计', 0), topic('实验分析', 5)])
    assert.equal(store.groups().length, 1)
    assert.equal(store.groups()[0].contextIds.length, 2)
    assert.equal(new Set(store.contexts().map(c => c.workingSessionId)).size, 2)
  } finally { store.close() }
})

test('automatic catalog blocks implicit CREATE until an unreadable history is repaired', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-catalog-admission-'))
  const model = fixture()
  const app = await harness(root, model, { routerMode: 'llm', routerTransport: 'dsh', historyCatalog: true })
  try {
    const old = await source(app, root, '论文方法：历史项目')
    const originalRead = app.ctx.sessionQuery.readSession.bind(app.ctx.sessionQuery)
    app.ctx.sessionQuery.readSession = async id => { if (id === old.id) throw new Error('unavailable'); return originalRead(id) }
    await app.ctx.theone.catalog!.refresh()
    const originalBehavior = model.behavior!
    model.behavior = async function* (options) {
      if (options.system === ROUTING_PROMPT) yield* textResponse(JSON.stringify({ action: 'CREATE', contextId: null, title: '摄影学习', question: null, reason: '独立的新事项' }))
      else yield* originalBehavior(options)
    }
    const blocked = await ask(app.gateway, '我想学习摄影，请给我一个计划')
    assert.match(blocked.output, /整理以前的聊天/)
    assert.equal(app.ctx.theone.store.route(blocked.input.id)?.decision.action, 'CLARIFY')
    assert.ok(!app.ctx.theone.store.contexts().some(c => c.title === '摄影学习'))
    app.ctx.sessionQuery.readSession = originalRead
    await app.ctx.theone.catalog!.refresh()
    assert.equal(app.ctx.theone.catalog!.incomplete, false)
    const created = await ask(app.gateway, '我想学习摄影，请给我一个计划')
    assert.equal(created.end?.data.reason.kind, 'completed')
    assert.equal(app.ctx.theone.store.route(created.input.id)?.decision.action, 'CREATE')
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('candidate miss is reviewed against remaining catalog before an implicit new topic is created', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-catalog-review-'))
  const model = fixture()
  const app = await harness(root, model, { routerMode: 'llm', routerTransport: 'dsh', historyCatalog: true })
  try {
    await app.ctx.theone.catalog!.refresh()
    app.ctx.theone.store.seed(Array.from({ length: 22 }, (_, i) => ({ id: 'old-' + String(i).padStart(3, '0'), title: '独立事项' + i, summary: '历史项目', entities: [], keywords: [], lastState: '待续' })))
    app.ctx.theone.store.seed([{ id: 'z-target', title: '旧论文方法', summary: '论文方法设计', entities: [], keywords: [], lastState: '待续' }])
    app.ctx.theone.catalog!.candidates = async () => app.ctx.theone.store.contexts().slice(0, 16)
    model.behavior = async function* (options) {
      if (options.system === ROUTING_PROMPT) {
        const payload = JSON.parse(options.messages[0].content.filter(b => b.type === 'text').map(b => b.text).join(''))
        yield* textResponse(JSON.stringify(payload.contexts.some((c: { id: string }) => c.id === 'z-target')
          ? { action: 'EXISTING', contextId: 'z-target', title: null, question: null, reason: '找到原来的论文' }
          : { action: 'CREATE', contextId: null, title: '论文新工作', question: null, reason: '首批没有候选' }))
      } else yield* textResponse('继续旧论文')
    }
    const count = app.ctx.theone.store.contexts().length
    const result = await ask(app.gateway, '继续以前论文那个方法')
    assert.equal(result.output, '继续旧论文')
    assert.equal(app.ctx.theone.store.route(result.input.id)?.decision.contextId, 'z-target')
    assert.equal(app.ctx.theone.store.contexts().length, count)
    assert.equal(model.requests.filter(r => r.system === ROUTING_PROMPT).length, 2)
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('history search failure yields clarification and does not dispatch a new Worker', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-catalog-search-failure-'))
  const app = await harness(root, fixture(), { routerMode: 'llm', routerTransport: 'dsh', historyCatalog: true })
  try {
    await app.ctx.theone.catalog!.refresh()
    app.ctx.theone.catalog!.candidates = async () => { throw new Error('private backend details') }
    const result = await ask(app.gateway, '学习摄影')
    assert.match(result.output, /历史检索暂时不可用/)
    assert.equal(app.ctx.theone.store.route(result.input.id)?.decision.action, 'CLARIFY')
    assert.equal(app.model.requests.length, 0)
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

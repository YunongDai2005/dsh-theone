import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import { HistoryCatalog, CATALOG_PROMPT } from '../src/history-catalog.ts'
import { ROUTING_PROMPT } from '../src/llm-router.ts'
import { harness, ask, FixtureModel, textResponse } from './harness.ts'

interface Payload { contexts?: { id: string }[]; turns?: { seq: number; text: string }[] }

function bodyOf(options: GenerateOptions): Payload {
  const blocks = options.messages[0].content.filter(block => block.type === 'text') as { text: string }[]
  return JSON.parse(blocks.map(block => block.text).join('')) as Payload
}

/** One topic per batch, named after the first turn; the classifier always proposes a new topic. */
function fixture() {
  const model = new FixtureModel()
  model.behavior = async function* (options) {
    if (options.system === CATALOG_PROMPT) {
      const payload = bodyOf(options)
      const title = payload.turns?.[0]?.text.includes('显卡') ? '显卡部署' : '论文方法'
      yield* textResponse(JSON.stringify({ topics: [{
        contextId: null, title, summary: `${title}的历史资料`, entities: [title], keywords: [title], lastState: '进行中',
        turns: (payload.turns ?? []).map(turn => turn.seq), groupId: null, groupTitle: '测试分组', groupSummary: '测试',
      }] }))
      return
    }
    if (options.system === ROUTING_PROMPT) {
      yield* textResponse(JSON.stringify({ action: 'CREATE', contextId: null, title: '新的任务', question: null,
        reason: '没有相关旧话题', historyIndependent: true, candidateIds: [], relatedIds: [] }))
      return
    }
    yield* textResponse('测试回答')
  }
  return model
}

async function source(app: Awaited<ReturnType<typeof harness>>, root: string, ...messages: string[]) {
  const handle = await app.ctx.agents.create({ sessionId: SessionId(randomUUID()), meta: { cwd: root },
    agentOptions: { provider: 'fixture', model: 'fixture' } })
  for (const message of messages) assert.equal((await ask(handle.agent, message)).end?.data.reason.kind, 'completed')
  return handle.agent
}

test('a topic whose conversations are gone stops reaching the router, and returns when they are back', { timeout: 60000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-orphan-'))
  const model = fixture()
  const app = await harness(root, model, { routerMode: 'llm' })
  const catalog = new HistoryCatalog(app.ctx, app.ctx.theone.store, () => ({ provider: 'fixture', model: 'fixture' }))
  try {
    const origin = await source(app, root, '论文方法：先写方法那一节')
    await catalog.refresh()
    const topic = catalog.snapshot().contexts.find(context => context.title === '论文方法')!
    assert.ok(topic)
    assert.equal(topic.hidden, undefined)
    assert.equal(catalog.snapshot().status.hidden, 0)

    // The conversation leaves the list of sessions that still exist: archived elsewhere, or deleted.
    const list = app.ctx.sessionQuery.listSessions.bind(app.ctx.sessionQuery)
    let listed = true
    app.ctx.sessionQuery.listSessions = async signal =>
      (await list(signal)).filter(record => listed || record.header.id !== origin.id)

    listed = false
    await catalog.refresh()
    assert.equal(catalog.snapshot().contexts.find(context => context.id === topic.id)!.hidden, 'orphaned')
    assert.equal(catalog.snapshot().status.hidden, 1)

    // Nothing the router is offered can mount it any more, and the classifier never sees it.
    const offered = await catalog.candidates('继续论文方法', undefined, undefined, {})
    assert.ok(!offered.some(context => context.id === topic.id))
    app.ctx.theone.store.mount('test-gateway', topic.id)
    await ask(app.gateway, '论文方法那边还缺一段论证')
    const routed = model.requests.filter(request => request.system === ROUTING_PROMPT).at(-1)!
    assert.ok(!(bodyOf(routed).contexts ?? []).some(context => context.id === topic.id))

    // Restoring the conversation clears the mark: hiding is recomputed, never a one-way delete.
    listed = true
    await catalog.refresh()
    assert.equal(catalog.snapshot().contexts.find(context => context.id === topic.id)!.hidden, undefined)
    assert.equal(catalog.snapshot().status.hidden, 0)
    assert.ok((await catalog.candidates('继续论文方法', undefined, undefined, {})).some(context => context.id === topic.id))
  } finally { await catalog.close(); await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('a topic whose conversations are all archived is hidden while archived and visible again after', { timeout: 60000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-archived-'))
  const model = fixture()
  const app = await harness(root, model, { routerMode: 'llm' })
  const catalog = new HistoryCatalog(app.ctx, app.ctx.theone.store, () => ({ provider: 'fixture', model: 'fixture' }))
  try {
    const origin = await source(app, root, '论文方法：归档测试')
    await catalog.refresh()
    const topic = catalog.snapshot().contexts.find(context => context.title === '论文方法')!
    // DSH's archive set is a plain list on the workspace registry; TheOne reads it when present.
    let archived: string[] = []
    app.ctx.provide('workspaceRegistry')
    app.ctx.set('workspaceRegistry', { get archivedSessionIds() { return archived } })

    archived = [topic.workingSessionId, origin.id]
    await catalog.refresh()
    assert.equal(catalog.snapshot().contexts.find(context => context.id === topic.id)!.hidden, 'archived')
    assert.equal(catalog.snapshot().status.hidden, 1)
    assert.ok(!(await catalog.candidates('继续论文方法', undefined, undefined, {})).some(context => context.id === topic.id))

    // Unarchiving brings the topic straight back, and its history is still indexed.
    archived = []
    await catalog.refresh()
    assert.equal(catalog.snapshot().contexts.find(context => context.id === topic.id)!.hidden, undefined)
    assert.equal(catalog.snapshot().status.hidden, 0)

    // Only the conversations that are all archived hide a topic; a readable source is enough to keep it.
    archived = [topic.workingSessionId]
    await catalog.refresh()
    assert.equal(catalog.snapshot().contexts.find(context => context.id === topic.id)!.hidden, undefined)
  } finally { await catalog.close(); await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('a topic whose Worker was never indexed is never mistaken for an orphan', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-catalog-orphan-guard-'))
  const model = fixture()
  const app = await harness(root, model)
  const catalog = new HistoryCatalog(app.ctx, app.ctx.theone.store, () => ({ provider: 'fixture', model: 'fixture' }))
  try {
    // A topic TheOne created itself: its Worker session is not on disk yet, so nothing about it is indexed.
    app.ctx.theone.store.seed([{ id: 'seeded', title: '刚建的话题', summary: '还没开始', entities: [], keywords: [], lastState: '' }])
    await catalog.refresh()
    assert.equal(catalog.snapshot().contexts.find(context => context.id === 'seeded')!.hidden, undefined)
    assert.equal(catalog.snapshot().status.hidden, 0)
    assert.ok((await catalog.candidates('刚建的话题', undefined, undefined, {})).some(context => context.id === 'seeded'))
  } finally { await catalog.close(); await app.close(); await rm(root, { recursive: true, force: true }) }
})

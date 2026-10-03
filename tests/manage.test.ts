import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { SessionId } from '@deepseek-ai/dsh-session'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import { ContextStore, WHOLE_SESSION } from '../src/store.ts'
import { ROUTING_PROMPT, routingPayload } from '../src/llm-router.ts'
import { spokenCorrection, topicTerms } from '../src/routing-policy.ts'
import type { RouteView } from '../src/types.ts'
import { harness, ask, FixtureModel, textResponse } from './harness.ts'

async function api(app: Awaited<ReturnType<typeof harness>>) {
  const connection = new HostConnectionService(app.ctx, [], undefined as never)
  const handler = connection.createSharedFetchHandler('/api')
  await new Promise<void>(resolve => setImmediate(resolve))
  return {
    get: async (path: string) => (await handler.fetch(new Request(`http://dsh.internal/api/theone/${path}`))).json(),
    post: (path: string, body: unknown) => handler.fetch(new Request(`http://dsh.internal/api/theone/${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })),
  }
}
const lastUserText = (model: FixtureModel) => {
  const message = [...model.requests.at(-1)!.messages].reverse().find(item => item.role === 'user' && 'source' in item && item.source?.kind === 'user')
  return message && 'content' in message ? (message.content as { type: string; text?: string }[]).map(block => block.text ?? '').join('') : ''
}

test('spoken corrections are recognised only as corrections, and learned terms skip filler', () => {
  assert.equal(spokenCorrection('分错了，是论文的'), '是论文的')
  assert.equal(spokenCorrection('不对，不是这个话题'), '')
  assert.equal(spokenCorrection('Wrong topic, it is the thesis one'), 'it is the thesis one')
  for (const text of ['分错误的数据怎么处理', '这个话题很有意思', '不对，再改一下标题']) assert.equal(spokenCorrection(text), undefined)
  assert.deepEqual(topicTerms('帮我把 Qwen 的显存设置调低一点'), ['Qwen', '显存设置调低一点'])
})

test('"wrong topic" redoes the previous message in the right topic and teaches it', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-correction-'))
  const app = await harness(root)
  try {
    const first = await ask(app.gateway, 'Qwen 的显存设置')
    assert.equal(first.output, '模拟回答：ctx_qwen_9070xt')
    const fixed = await ask(app.gateway, '分错了，是论文的')
    assert.equal(fixed.output, '模拟回答：ctx_thesis')
    const route = app.ctx.theone.store.route(fixed.input.id)?.decision
    assert.equal(route?.action, 'MOUNT')
    assert.equal(route?.reason, 'correction')
    assert.equal(route?.correctionOf, first.input.id)
    // The right topic's Worker receives the original message together with the correction.
    assert.match(lastUserText(app.model), /Qwen 的显存设置[\s\S]*分错了，是论文的/)
    assert.equal(app.ctx.theone.store.current('test-gateway'), 'ctx_thesis')
    const records = app.ctx.theone.store.recentRoutes('test-gateway')
    assert.equal(records.find(item => item.messageId === first.input.id)?.correctedTo, 'ctx_thesis')
    assert.equal(records.find(item => item.messageId === first.input.id)?.excerpt, 'Qwen 的显存设置')
    const thesis = app.ctx.theone.store.contexts().find(context => context.id === 'ctx_thesis')!
    assert.ok(thesis.keywords.includes('显存设置'))
    assert.ok(!thesis.keywords.includes('Qwen'), 'a term naming another topic stays with it')
    // Correcting again is about the original message, and never returns it to the topic just ruled out.
    const again = await ask(app.gateway, '分错了')
    const back = app.ctx.theone.store.route(again.input.id)?.decision
    assert.equal(back?.correctionOf, first.input.id)
    assert.equal(back?.contextId, 'ctx_qwen_9070xt')
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('the directory lists routes, moves a misrouted message, and the classifier learns from it', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-routes-'))
  const payloads: ReturnType<typeof routingPayload>[] = []
  const model = new FixtureModel()
  model.behavior = async function* (options) {
    if (options.system === ROUTING_PROMPT) {
      payloads.push(JSON.parse((options.messages[0] as unknown as { content: { text: string }[] }).content[0].text))
      yield* textResponse(JSON.stringify({ action: 'EXISTING', contextId: 'ctx_qwen_9070xt', title: null, question: null, reason: '提到 Qwen' }))
      return
    }
    yield* textResponse('好')
  }
  const app = await harness(root, model, { routerMode: 'llm', theoneConfig: { routeNotice: 'all' } })
  try {
    const client = await api(app)
    const first = await ask(app.gateway, 'Qwen 的消融表格')
    // Showing every decision also says why.
    const notice = first.events.find(event => event.type === 'user/message' && event.data.source.kind === 'theone-route')
    assert.ok(notice?.type === 'user/message' && notice.data.source.kind === 'theone-route' && notice.data.source.summary.endsWith('· 提到 Qwen'))
    const listed = await client.get('routes') as { routes: RouteView[] }
    assert.equal(listed.routes[0].messageId, first.input.id)
    assert.equal(listed.routes[0].receipt?.mode, 'llm')
    assert.equal(listed.routes[0].receipt?.model, 'fixture')
    assert.equal((await client.post('routes', { messageId: first.input.id, contextId: 'missing' })).status, 400)
    const moved = await client.post('routes', { messageId: first.input.id, contextId: 'ctx_thesis' })
    assert.equal(moved.status, 200)
    assert.equal(((await moved.json()) as { routes: RouteView[] }).routes[0].correctedTo, 'ctx_thesis')
    assert.equal(app.ctx.theone.store.current('test-gateway'), 'ctx_thesis')
    await ask(app.gateway, '把消融表格再整理一下')
    assert.deepEqual(payloads.at(-1)!.corrections, [{ text: 'Qwen 的消融表格', rightId: 'ctx_thesis', wrongId: 'ctx_qwen_9070xt' }])
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('topics can be created, edited, moved, given sessions, merged and deleted from the directory', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-topics-'))
  const app = await harness(root)
  try {
    const client = await api(app)
    const store = app.ctx.theone.store
    const created = await client.post('topics', { action: 'create', title: '旅行计划' })
    assert.equal(created.status, 200)
    const { id } = await created.json() as { id: string }
    assert.equal((await client.post('topics', { action: 'create', title: '旅行计划' })).status, 400)
    assert.equal((await client.post('topics', { action: 'edit', id, title: 'Qwen / RX 9070 XT' })).status, 400)
    assert.equal((await client.post('topics', { action: 'edit', id, title: '京都旅行', summary: '十月去京都', constraints: '预算只用于订酒店' })).status, 200)
    let topic = store.contexts().find(context => context.id === id)!
    assert.equal(topic.title, '京都旅行')
    assert.equal(topic.summary, '十月去京都')
    assert.equal(store.constraints(id)?.text, '预算只用于订酒店')
    const catalog = await client.get('catalog') as { linkage: { topics: Record<string, { constraints?: string }> } }
    assert.equal(catalog.linkage.topics[id].constraints, '预算只用于订酒店')
    assert.equal((await client.post('topics', { action: 'move', id, groupTitle: '生活' })).status, 200)
    assert.ok(store.groups().some(group => group.title === '生活' && group.contextIds.includes(id)))

    // An ordinary DSH session can become this topic's searchable history.
    const other = (await app.ctx.agents.create({ sessionId: SessionId(randomUUID()), agentOptions: { provider: 'fixture', model: 'fixture' } })).agent
    app.model.behavior = async function* () { yield* textResponse('京都的红叶十一月最好') }
    await ask(other, '京都红叶什么时候看')
    app.model.behavior = undefined
    const sessions = await client.get('sessions') as { sessions: { id: string }[] }
    assert.ok(sessions.sessions.some(session => session.id === other.id))
    assert.equal((await client.post('topics', { action: 'attach', id, sessionId: 'not-a-session' })).status, 400)
    assert.equal((await client.post('topics', { action: 'attach', id, sessionId: other.id })).status, 200)
    assert.deepEqual(store.sourceRanges(id).find(range => range.sessionId === other.id), { sessionId: other.id, kind: 'bounded', ...WHOLE_SESSION })
    assert.equal((await app.ctx.theone.searchHistoryDetailed(id, '红叶')).windows.length > 0, true)

    // Merging moves history, progress, constraints and the current topic, then removes the source.
    await ask(app.gateway, 'Qwen 的配置')
    store.setConstraints('ctx_qwen_9070xt', '显卡型号保密')
    const qwenWorker = store.contexts().find(context => context.id === 'ctx_qwen_9070xt')!.workingSessionId
    assert.equal((await client.post('topics', { action: 'merge', id: 'ctx_qwen_9070xt', into: 'ctx_qwen_9070xt' })).status, 400)
    assert.equal((await client.post('topics', { action: 'merge', id: 'ctx_qwen_9070xt', into: id })).status, 200)
    assert.ok(!store.contexts().some(context => context.id === 'ctx_qwen_9070xt'))
    topic = store.contexts().find(context => context.id === id)!
    assert.ok(topic.entities.includes('Qwen'))
    assert.equal(store.current('test-gateway'), id)
    assert.match(store.constraints(id)!.text, /预算只用于订酒店\n显卡型号保密/)
    assert.ok(store.sourceRanges(id).some(range => range.sessionId === qwenWorker))
    assert.equal(store.indexState(qwenWorker)?.status, 'excluded')
    assert.equal((await ask(app.gateway, '京都旅行的酒店')).output, `模拟回答：${id}`)

    assert.equal((await client.post('topics', { action: 'delete', id })).status, 200)
    assert.ok(!store.contexts().some(context => context.id === id))
    assert.equal(store.current('test-gateway'), undefined)
    assert.equal((await client.post('topics', { action: 'delete', id })).status, 400)
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('a deleted topic is not extracted again from the same conversation', () => {
  const store = new ContextStore(':memory:')
  try {
    store.importTopics('session-a', undefined, [{ seq: 1, endSeq: 2, text: '京都', fingerprint: 'f1' }],
      [{ contextId: null, title: '京都', summary: '旅行', entities: [], keywords: [], lastState: '计划', turns: [1], groupId: null, groupTitle: '生活', groupSummary: '' }])
    const id = store.contexts()[0].id
    store.deleteTopic(id)
    assert.equal(store.contexts().length, 0)
    assert.equal(store.dismissedTurn('session-a', 1), 'f1')
  } finally { store.close() }
})

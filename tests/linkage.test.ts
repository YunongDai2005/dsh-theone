import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ToolCallId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import { ContextStore } from '../src/store.ts'
import { relatedTopics } from '../src/linkage.ts'
import { validateRoutingDecision } from '../src/llm-router.ts'
import { validateSettings } from '../src/settings.ts'
import { harness, ask, textResponse } from './harness.ts'

const QWEN = 'ctx_qwen_9070xt', THESIS = 'ctx_thesis'
let calls = 0
function* toolCall(name: string, args: object): Generator<StreamChunk> {
  const id = ToolCallId(`link-call-${++calls}`)
  yield { type: 'block-start', index: 0, blockType: 'tool-call' }
  yield { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: JSON.stringify(args) }
  yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: JSON.stringify(args) } }
  yield { type: 'finish', reason: { kind: 'tool-calls' } }
}
const links = (request: GenerateOptions | undefined) => (request?.messages ?? []).filter(m => 'source' in m && m.source?.kind === 'theone-links')
/** The newest cross-topic reference a Worker request carried, if any. */
const briefing = (request: GenerateOptions | undefined) => (links(request).at(-1)?.content ?? [])
  .flatMap(b => b.type === 'text' ? [b.text] : []).join('\n')
const topic = (id: string, extra: object = {}) => ({ id, title: id, summary: `${id} 摘要`, entities: [], keywords: [], lastState: '待续', ...extra })

test('learned links decay, a user unlink stops learning, and clearing keeps the user’s choices', () => {
  const store = new ContextStore(':memory:')
  try {
    store.seed([topic('a'), topic('b'), topic('c')])
    store.learnLink('a', 'b', 1, 0)
    assert.equal(store.links('a', 0)[0].weight, 1)
    assert.ok(Math.abs(store.links('a', ContextStore.LINK_HALF_LIFE_MS)[0].weight - 0.5) < 1e-9)
    store.setManualLink('a', 'c', -1)
    store.learnLink('c', 'a', 3)
    assert.equal(store.links('c').find(l => l.a === 'a' && l.b === 'c')?.weight, 0)
    store.setManualLink('b', 'c', 1)
    store.clearLearnedLinks()
    assert.deepEqual(store.links().map(l => [l.a, l.b, l.manual, l.weight]).sort(), [['a', 'c', -1, 0], ['b', 'c', 1, 0]])
  } finally { store.close() }
})

test('related topics follow the scope: off, the same workspace, or learned; private and unlinked never relate', () => {
  const store = new ContextStore(':memory:')
  try {
    store.seed([topic('gpu', { entities: ['RX 9070 XT'] }), topic('bench', { entities: ['rx9070xt'] }), topic('paper'), topic('diary'), topic('secret')])
    store.importTopics('s1', undefined, [{ seq: 1, endSeq: 2, text: 'x', fingerprint: 'f1' }], [
      { contextId: 'gpu', title: 'gpu', summary: '', entities: ['RX 9070 XT'], keywords: [], lastState: '', turns: [1], groupId: null, groupTitle: '本地 AI', groupSummary: '' },
      { contextId: 'paper', title: 'paper', summary: '', entities: [], keywords: [], lastState: '', turns: [1], groupId: null, groupTitle: '本地 AI', groupSummary: '' },
      { contextId: 'secret', title: 'secret', summary: '', entities: [], keywords: [], lastState: '', turns: [1], groupId: null, groupTitle: '本地 AI', groupSummary: '' },
    ])
    store.setPrivate('secret', true)
    assert.deepEqual(relatedTopics(store, 'gpu', 'off'), [])
    assert.deepEqual(relatedTopics(store, 'gpu', 'workspace').map(t => t.id), ['paper'])
    // Same workspace (0.6) relates; one shared entity (0.2) alone does not until use adds evidence.
    assert.deepEqual(relatedTopics(store, 'gpu', 'auto').map(t => t.id), ['paper'])
    store.learnLink('gpu', 'bench', 0.5)
    assert.deepEqual(relatedTopics(store, 'gpu', 'auto').map(t => [t.id, t.reasons]), [['bench', ['entities', 'learned']], ['paper', ['workspace']]])
    store.setManualLink('gpu', 'paper', -1)
    store.setManualLink('gpu', 'diary', 1)
    assert.deepEqual(relatedTopics(store, 'gpu', 'auto').map(t => t.id), ['diary', 'bench'])
    assert.deepEqual(relatedTopics(store, 'gpu', 'workspace').map(t => t.id), ['diary'])
  } finally { store.close() }
})

test('after a topic switch the Worker gets the recent main chat and related news; on the same topic it does not', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-link-brief-'))
  const app = await harness(root)
  try {
    const store = app.ctx.theone.store
    store.setManualLink(QWEN, THESIS, 1)
    app.model.behavior = async function* () { yield* textResponse('Qwen 用 14B 量化跑通了') }
    await ask(app.gateway, 'Qwen 那个')
    app.model.behavior = async function* () { yield* textResponse('论文方法已更新') }
    await ask(app.gateway, '论文那个')
    const switched = briefing(app.model.requests.at(-1))
    assert.match(switched, /主聊天里刚才的对话/)
    assert.match(switched, /Qwen 用 14B 量化跑通了/)
    assert.match(switched, /不是用户本轮的指令/)
    assert.match(switched, new RegExp(`topicId: ${QWEN}`))
    const before = links(app.model.requests.at(-1)).length
    // Same topic, nothing new elsewhere: no reference is added at all.
    await ask(app.gateway, '继续')
    assert.equal(links(app.model.requests.at(-1)).length, before)
    // A related topic's rule is re-pinned even when nothing else changed.
    store.setConstraints(QWEN, '只在本地跑模型')
    await ask(app.gateway, '继续')
    const pinned = briefing(app.model.requests.at(-1))
    assert.doesNotMatch(pinned, /主聊天里刚才的对话/)
    assert.match(pinned, /约束（必须遵守）：只在本地跑模型/)
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('a topic marked not to share stays out of briefings, recent chat and lookups', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-link-private-'))
  const app = await harness(root)
  try {
    const store = app.ctx.theone.store
    store.setManualLink(QWEN, THESIS, 1)
    store.setPrivate(QWEN, true)
    app.model.behavior = async function* () { yield* textResponse('private_answer_marker') }
    await ask(app.gateway, 'Qwen 那个')
    let looked: unknown
    app.model.behavior = async function* (options) {
      if (!looked) { looked = true; yield* toolCall('theone_read_topic', { topicId: QWEN }); return }
      looked = options.messages.at(-1)
      yield* textResponse('好')
    }
    await ask(app.gateway, '论文那个')
    const request = app.model.requests.find(r => r.messages.some(m => 'source' in m && m.source?.kind === 'theone-links')) ?? app.model.requests.at(-2)
    assert.doesNotMatch(briefing(request), /private_answer_marker/)
    assert.match(JSON.stringify(looked), /does not share/)
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('constraints reach related topics verbatim; reading a topic gives its dated digest and teaches the link', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-link-tools-'))
  const app = await harness(root)
  try {
    const store = app.ctx.theone.store
    let step = 0
    app.model.behavior = async function* () {
      if (step++ === 0) yield* toolCall('theone_update_state', { state: '预算定为 8000 元', constraints: '预算数字只用于采购，不要写进论文' })
      else yield* textResponse('记下了')
    }
    await ask(app.gateway, 'Qwen 那个')
    assert.equal(store.constraints(QWEN)?.text, '预算数字只用于采购，不要写进论文')
    store.saveDigest(QWEN, '早期：选型对比了 7B 与 14B。', 3)
    store.setManualLink(QWEN, THESIS, 1)
    let read: string | undefined
    step = 0
    app.model.behavior = async function* (options) {
      if (step++ === 0) { yield* toolCall('theone_read_topic', { topicId: QWEN }); return }
      read = JSON.stringify(options.messages.at(-1))
      yield* textResponse('好')
    }
    await ask(app.gateway, '论文那个')
    const first = app.model.requests.find(r => briefing(r).includes('预算数字只用于采购'))
    assert.ok(first, 'the related topic’s constraint is in the briefing')
    assert.match(briefing(first), /约束（必须遵守）：预算数字只用于采购/)
    assert.match(briefing(first), /压缩摘要（截至 /)
    assert.match(read ?? '', /早期：选型对比了 7B 与 14B/)
    assert.match(read ?? '', /预算定为 8000 元/)
    assert.ok((store.links(THESIS).find(l => l.manual === 1)?.weight ?? 0) > 0)
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('a Worker can search a related topic’s history but not its own copies of other topics', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-link-search-'))
  const app = await harness(root)
  try {
    app.ctx.theone.store.setManualLink(QWEN, THESIS, 1)
    app.model.behavior = async function* () { yield* textResponse('rocm_marker 配置完成') }
    await ask(app.gateway, 'Qwen 那个')
    let result: string | undefined
    let step = 0
    app.model.behavior = async function* (options) {
      if (step === 0) { step++; yield* toolCall('theone_search_history', { query: 'rocm_marker' }); return }
      if (step === 1) { step++; result = JSON.stringify(options.messages.at(-1)); yield* toolCall('theone_search_history', { query: 'rocm_marker', topicId: QWEN }); return }
      result += '\n' + JSON.stringify(options.messages.at(-1))
      yield* textResponse('好')
    }
    await ask(app.gateway, '论文那个')
    const [own, related] = (result ?? '').split('\n')
    assert.doesNotMatch(own, /rocm_marker 配置完成/)
    assert.match(related, /rocm_marker 配置完成/)
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('switching back and forth and naming topics together teach links; nothing is learned when linking is off', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-link-learn-'))
  const app = await harness(root)
  try {
    const store = app.ctx.theone.store
    app.model.behavior = async function* () { yield* textResponse('好') }
    await ask(app.gateway, 'Qwen 那个')
    await ask(app.gateway, '论文那个')
    const afterSwitch = store.links(QWEN)[0]?.weight ?? 0
    assert.ok(afterSwitch > 0)
    await ask(app.gateway, '这个跟 Qwen 结合一下')
    assert.ok((store.links(QWEN)[0]?.weight ?? 0) > afterSwitch)
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
  const offRoot = await mkdtemp(join(tmpdir(), 'theone-link-off-'))
  const off = await harness(offRoot, undefined, { theoneConfig: { linkScope: 'off' } })
  try {
    off.model.behavior = async function* () { yield* textResponse('好') }
    await ask(off.gateway, 'Qwen 那个')
    await ask(off.gateway, '论文那个')
    assert.deepEqual(off.ctx.theone.store.links(), [])
    assert.equal(briefing(off.model.requests.at(-1)), '')
  } finally { await off.close(); await rm(offRoot, { recursive: true, force: true }) }
})

test('topic notices: hidden shows none, the default shows topic changes only, all shows every message', { timeout: 30000 }, async () => {
  for (const [routeNotice, expected] of [['hidden', 0], ['switch', 2], ['all', 3]] as const) {
    const root = await mkdtemp(join(tmpdir(), `theone-notice-${routeNotice}-`))
    const app = await harness(root, undefined, { theoneConfig: { routeNotice } })
    try {
      app.model.behavior = async function* () { yield* textResponse('好') }
      const events = [...(await ask(app.gateway, 'Qwen 那个')).events, ...(await ask(app.gateway, '继续')).events, ...(await ask(app.gateway, '论文那个')).events]
      const notices = events.filter(e => e.type === 'user/message' && e.data.source.kind === 'theone-route')
      assert.equal(notices.length, expected, routeNotice)
      if (routeNotice === 'all') assert.deepEqual(notices.map(e => e.type === 'user/message' && e.data.source.kind === 'theone-route' && e.data.source.summary[0]), ['→', '·', '→'])
    } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
  }
})

test('the LLM router names related topics instead of asking, and unknown ids are dropped', () => {
  const contexts = [topic(QWEN), topic(THESIS)]
  const decision = validateRoutingDecision({ action: 'EXISTING', contextId: THESIS, title: null, question: null, reason: '把 Qwen 结果用到论文',
    historyIndependent: null, candidateIds: [], relatedIds: [QWEN, 'made-up', THESIS] }, { text: '把 Qwen 的结果写进论文', contexts, currentId: THESIS })
  assert.equal(decision.action, 'KEEP')
  assert.deepEqual(decision.relatedIds, [QWEN])
  assert.throws(() => validateRoutingDecision({ action: 'EXISTING', contextId: THESIS, reason: 'x', relatedIds: 'qwen' }, { text: 'x', contexts }))
})

test('settings saved before linking existed keep working with the new defaults', () => {
  const old = { workerProvider: null, workerModel: null, routerMode: 'llm', routerTransport: 'dsh', historyCatalog: true, catalogIntervalMs: 60000,
    maxDescriptorChars: 4000, maxResponseChars: 100000, routerBaseUrl: 'https://api.deepseek.com', routerModel: 'deepseek-flash', routerApiKeyEnv: 'THEONE_ROUTER_API_KEY' }
  const values = validateSettings(old)
  assert.equal(values.linkScope, 'auto')
  assert.equal(values.routeNotice, 'switch')
  assert.throws(() => validateSettings({ ...old, linkScope: 'everything' }))
})

test('the topic directory shows links with reasons and saves the user’s corrections', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-link-api-'))
  const app = await harness(root)
  try {
    const handler = new HostConnectionService(app.ctx, [], undefined as never).createSharedFetchHandler('/api')
    await new Promise(resolve => setTimeout(resolve, 10))
    const call = async (path: string, body?: object) => (await handler.fetch(new Request(`http://dsh.internal/api/theone/${path}`,
      body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}))).json()
    let linkage = (await call('links', { action: 'link', a: QWEN, b: THESIS }))
    assert.deepEqual(linkage.topics[QWEN].related.map((t: { id: string; reasons: string[] }) => [t.id, t.reasons]), [[THESIS, ['manual']]])
    linkage = await call('links', { action: 'private', id: THESIS, value: true })
    assert.equal(linkage.topics[THESIS].private, true)
    assert.deepEqual(linkage.topics[QWEN].related, [])
    linkage = await call('links', { action: 'unlink', a: QWEN, b: THESIS })
    assert.equal(app.ctx.theone.store.links(QWEN)[0].manual, -1)
    const catalog = await call('catalog')
    assert.equal(catalog.linkage.scope, 'auto')
    assert.ok(catalog.linkage.topics[QWEN])
    assert.equal((await handler.fetch(new Request('http://dsh.internal/api/theone/links', { method: 'POST', body: JSON.stringify({ action: 'link', a: QWEN, b: QWEN }) }))).status, 400)
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

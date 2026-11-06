import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ROUTING_PROMPT } from '../src/llm-router.ts'
import { MERGE_VET_PROMPT } from '../src/merge-vetting.ts'
import { CARD_PROMPT, type TopicCard } from '../src/topic-memory.ts'
import { ContextStore } from '../src/store.ts'
import * as policy from '../src/routing-policy.ts'
import { harness, ask, FixtureModel, textResponse } from './harness.ts'

const OLD = 'ctx_thesis', TITLE = '论文第三章'
const card: TopicCard = { summary: '毕业设计第三章', aliases: ['毕设'], entities: ['THESIS-2026'], settled: [], open: [] }
async function fixture(options: { route?: 'manual' | 'imported'; beforeCard?: () => Promise<void> } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'theone-merge-')), model = new FixtureModel()
  const app = await harness(root, model, { routerMode: 'llm', theoneConfig: { topicCards: true } }), store = app.ctx.theone.store
  store.applyCard(OLD, card)
  let existing: string | undefined, currentCard = card
  if (options.route === 'manual') existing = store.createTopic(TITLE)
  if (options.route === 'imported') {
    store.importTopics('historical-session', undefined, [], [{ title: TITLE, summary: '历史中的论文', lastState: '', entities: [], keywords: [], contextId: null, turns: [], groupId: null, groupTitle: null, groupSummary: '' }])
    existing = store.contexts().find(topic => topic.title === TITLE)!.id
  }
  model.behavior = async function* (request) {
    if (request.system?.startsWith(ROUTING_PROMPT)) {
      yield* textResponse(JSON.stringify(existing ? { action: 'EXISTING', contextId: existing, reason: 'fixture' }
        : { action: 'CREATE', title: TITLE, historyIndependent: true, reason: 'fixture' })); return
    }
    if (request.system === CARD_PROMPT) { await options.beforeCard?.(); yield* textResponse(JSON.stringify(currentCard)); return }
    if (request.system === MERGE_VET_PROMPT) {
      const payload = JSON.parse((request.messages[0].content as readonly { text: string }[])[0].text)
      yield* textResponse(JSON.stringify({ decisions: payload.pairs.map((pair: any) => ({ pairId: pair.pairId,
        sameMatter: true, confidence: 0.96, keepId: pair.topics.find((topic: any) => topic.id !== newId()).id, reason: '同一论文' })) })); return
    }
    yield* textResponse('正文回答')
  }
  const newId = () => existing ?? store.contexts().find(topic => topic.title === TITLE)!.id
  return { ...app, store, newId,
    suggestions: () => store.mergeSuggestions(),
    setCard: (value: TopicCard) => { currentCard = value },
    start: async () => {
      const result = await ask(app.gateway, '帮我写第三章')
      existing = store.route(result.input.id)!.decision.contextId
      await app.ctx.theone.extracting
      await (app.ctx.theone as any).mergeVetter.tick()
    },
    rewrite: async () => {
      const id = newId(), topic = store.contexts().find(topic => topic.id === id)!
      await ask(app.gateway, '请完善第三章内容')
      ;(app.ctx.theone as any).queueCard(app.ctx.agents.get(SessionId(topic.workingSessionId)), id)
      await app.ctx.theone.extracting
      await (app.ctx.theone as any).mergeVetter.tick()
    },
    close: async () => { await app.close(); await rm(root, { recursive: true, force: true }) },
  }
}

for (const route of ['manual', 'imported'] as const) test(`${route} topics do not acquire a suggestion on their first card`, async () => {
  const app = await fixture({ route })
  try { await app.start(); assert.deepEqual(app.suggestions(), []) } finally { await app.close() }
})

for (const action of ['move', 'delete', 'merge'] as const) test(`a routed topic ${action} before its first card is not suggested`, async () => {
  const ready = Promise.withResolvers<void>(), release = Promise.withResolvers<void>()
  const app = await fixture({ beforeCard: async () => { ready.resolve(); await release.promise } })
  try {
    const pending = app.start(); await ready.promise
    const id = app.newId()
    if (action === 'move') app.store.moveTopic(id, { title: '用户自己的工作区' })
    if (action === 'delete') app.store.deleteTopic(id)
    if (action === 'merge') app.store.mergeTopics(id, OLD)
    release.resolve(); await pending
    assert.deepEqual(app.suggestions(), [])
  } finally { release.resolve(); await app.close() }
})

test('a later materially changed card can discover a previously unmatched pair in llm mode', async () => {
  const app = await fixture()
  try {
    app.setCard({ summary: '完全独立的事', aliases: [], entities: [], settled: [], open: [] })
    await app.start(); assert.deepEqual(app.suggestions(), [])
    app.setCard(card); await app.rewrite(); assert.equal(app.suggestions().length, 1)
  } finally { await app.close() }
})

test('candidate selection prefers exact names then activity and excludes hidden and legacy-suppressed pairs', async () => {
  const ready = Promise.withResolvers<void>(), release = Promise.withResolvers<void>()
  const app = await fixture({ beforeCard: async () => { ready.resolve(); await release.promise } })
  try {
    const first = app.start(); await ready.promise
    for (const [id, title, entities, at] of [
      ['weaker', '刚活动过的分支', ['毕设', 'THESIS-2026'], 9000],
      ['older', '旧主线', [TITLE, '毕设', 'THESIS-2026'], 100],
      ['newer', '最近主线', [TITLE, '毕设', 'THESIS-2026'], 200],
      ['hidden', '已排除的主线', [TITLE, '毕设', 'THESIS-2026'], 9999],
      ['asked', '已问过的主线', [TITLE, '毕设', 'THESIS-2026'], 99999],
    ] as const) {
      app.store.seed([{ id, title, entities: [...entities], summary: title, lastState: '', keywords: [] }])
      app.store.startTopicRun(`run:${id}`, id, `session:${id}`, at); app.store.endTopicRun(`run:${id}`, 'completed', at)
    }
    app.store.replaceHidden([{ id: 'hidden', reason: 'excluded' }])
    app.store.recordMergePrompt(app.newId(), 'asked', 'dismissed')
    release.resolve(); await first
    assert.equal(app.suggestions().length, 1)
    assert.equal(app.suggestions()[0].directions[0].targetId, 'newer')
    assert.equal(app.store.mergePrompt(app.newId(), 'asked')?.answer, 'dismissed', 'legacy reservations never become explicit declines')
    assert.equal(app.store.mergePrompt(app.newId(), OLD), undefined)
  } finally { release.resolve(); await app.close() }
})

test('legacy dismissed pairs are not asked again and failed cards do not consume the first check', async () => {
  const ready = Promise.withResolvers<void>(), release = Promise.withResolvers<void>()
  const app = await fixture({ beforeCard: async () => { ready.resolve(); await release.promise } })
  try {
    const first = app.start(); await ready.promise
    app.store.recordMergePrompt(app.newId(), OLD, 'dismissed')
    release.resolve(); await first
    assert.deepEqual(app.suggestions(), [])
    assert.equal(app.store.mergePrompt(app.newId(), OLD)?.answer, 'dismissed')
  } finally { release.resolve(); await app.close() }
  const retry = await fixture()
  try {
    retry.setCard({ ...card, summary: '' }); await retry.start(); assert.deepEqual(retry.suggestions(), [])
    retry.setCard(card); await retry.rewrite(); assert.equal(retry.suggestions().length, 1)
  } finally { await retry.close() }
})

test('the suggestion belongs to the last routed gateway, and another card cannot reserve the same pair', async () => {
  const ready = Promise.withResolvers<void>(), release = Promise.withResolvers<void>()
  const app = await fixture({ beforeCard: async () => { ready.resolve(); await release.promise } })
  try {
    const first = app.start(); await ready.promise
    const second = (await app.ctx.agents.create({ sessionId: SessionId('merge-second-gateway'), agentOptions: { provider: 'theone', model: 'gateway' } })).agent
    await ask(second, '请接着写第三章内容')
    release.resolve(); await first
    assert.equal(app.suggestions().length, 1)
    assert.equal(app.suggestions()[0].scope.gatewayId, second.id)
    assert.deepEqual(app.ctx.theone.bubbleView(app.gateway.id).mergeSuggestions, [])
    assert.equal(app.ctx.theone.bubbleView(second.id).mergeSuggestions?.length, 1)
    await app.rewrite()
    assert.equal(app.suggestions().length, 1)
  } finally { release.resolve(); await app.close() }
})


test('merge prompt pairs normalize order, survive reopening and merge undo, and deletion clears both columns', async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-merge-store-')), path = join(root, 'store.db')
  let store = new ContextStore(path)
  try {
    const a = store.createTopic('A'), b = store.createTopic('B'), c = store.createTopic('C')
    store.recordMergePrompt(b, a, 'declined', 10)
    store.recordMergePrompt(c, a, 'dismissed', 20)
    assert.deepEqual(store.mergePrompt(a, b), { answer: 'declined', at: 10 })
    store.mergeTopics(b, a); store.unmergeTopic(b)
    assert.equal(store.mergePrompt(b, a)?.answer, 'declined')
    store.close(); store = new ContextStore(path)
    assert.equal(store.mergePrompt(b, a)?.answer, 'declined')
    store.deleteTopic(a)
    assert.equal(store.mergePrompt(a, b), undefined)
    assert.equal(store.mergePrompt(c, a), undefined)
  } finally { store.close(); await rm(root, { recursive: true, force: true }) }
})

test('similarity requires the same normalized folder and two substantial exact names or a close title', () => {
  const match = policy.mergeSimilarity
  const a = { title: '论文第三章', names: ['「毕设」', ' THESIS-2026! '], entities: ['AI', 'X'], cwd: 'C:/Projects/Thesis/' }
  const b = { title: '毕业论文', names: ['毕设'], entities: ['thesis-2026'], cwd: 'c:\\projects\\thesis\\.' }
  assert.equal(match(a, b)?.sharedNames, 2)
  assert.equal(match({ title: 'Qwen 本地部署指南' }, { title: 'Qwen 本地部署' })?.sharedNames, 0)
  assert.equal(match(a, { ...b, cwd: 'C:/Projects/Other' }), undefined)
  assert.equal(match(a, { ...b, cwd: undefined }), undefined)
  assert.equal(match({ title: '机器学习论文', names: ['论文'] }, { title: '采购计划', names: ['论文'] }), undefined)
  assert.equal(match({ title: '机器学习论文', names: ['AI', 'PC', '甲', '甲乙'] }, { title: '采购计划', names: ['ai', 'pc', '甲', '甲乙'] }), undefined)
  assert.equal(match({ title: 'alpha beta gamma' }, { title: 'alpha beta delta epsilon' }), undefined)
  assert.ok(match({ title: 'alpha beta gamma' }, { title: 'alpha beta delta' }))
  assert.equal(match({ title: '相同标题', cwd: '/' }, { title: '相同标题' }), undefined)
  assert.equal(match({ title: '无关一', names: ['毕设', '毕设'] }, { title: '另件二', names: ['毕设', '毕设'] }), undefined)
})

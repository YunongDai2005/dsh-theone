import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ContextStore } from '../src/store.ts'
import { routingPayload } from '../src/llm-router.ts'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ROUTING_PROMPT } from '../src/llm-router.ts'
import { activityLabel, CARD_PROMPT, cardDue, learnDormancy, parseCard, returnNote, routingSummary } from '../src/topic-memory.ts'
import { FixtureModel, harness, ask, textResponse } from './harness.ts'

const DAY = 86400000

test('the set-aside line is learned from when the user came back, with a prior until there is enough', () => {
  assert.equal(learnDormancy([]).global, 7 * DAY)
  // 30 returns, all within two days: the line moves well below the 7-day prior.
  const quick = Array.from({ length: 60 }, (_, i) => ({ contextId: i % 2 ? 'a' : 'b', at: i * 2 * DAY / 2 }))
  const learned = learnDormancy(quick)
  assert.ok(learned.returns >= 20 && learned.global < 3 * DAY && learned.global >= DAY)
  // A topic that once came back after 40 days keeps a longer line of its own.
  const periodic = [...quick, { contextId: 'c', at: 0 }, { contextId: 'c', at: 40 * DAY }]
  assert.ok(learnDormancy(periodic).perTopic.get('c')! >= 60 * DAY)
  // Messages in a row on one topic are not returns.
  assert.equal(learnDormancy([{ contextId: 'a', at: 0 }, { contextId: 'a', at: 60000 }]).returns, 0)
  assert.deepEqual(activityLabel(0, 7 * DAY, 10 * DAY), { text: '已搁置（10 天未动）', dormant: true })
  assert.deepEqual(activityLabel(0, 7 * DAY, 3 * 3600000), { text: '3 小时前', dormant: false })
})

test('a card adds names and entities, replaces only a placeholder summary, and reaches routing', () => {
  const store = new ContextStore(':memory:')
  store.seed([{ id: 'cafe', title: '咖啡店秋季上新', summary: '新话题，尚无历史摘要。', entities: [], keywords: ['咖啡店秋季上新'], lastState: '' }])
  assert.equal(parseCard({ summary: '' }, text => text), undefined)
  const card = parseCard({ summary: '咖啡店秋季新品上线：定价、上新日期、宣传', aliases: ['上新日期', '南瓜拿铁', 42], entities: ['桂花冷萃'], open: ['上新日期'] }, text => text)!
  store.applyCard('cafe', card)
  const topic = store.contexts()[0]
  assert.equal(topic.summary, '咖啡店秋季新品上线：定价、上新日期、宣传')
  assert.deepEqual(store.names('cafe').get('cafe'), ['上新日期', '南瓜拿铁'])
  assert.deepEqual(store.openItems('cafe'), ['上新日期'])
  assert.equal(routingSummary(topic.summary, store.settled('cafe'), store.openItems('cafe')), '咖啡店秋季新品上线：定价、上新日期、宣传 待定：上新日期')
  assert.deepEqual(topic.entities, ['桂花冷萃'])
  const payload = routingPayload({ text: '上新日期得改', contexts: [{ ...topic, activity: '3 小时前' }] })
  assert.equal(payload.contexts[0].activity, '3 小时前')
  assert.ok(!('activity' in routingPayload({ text: 'x', contexts: [topic] }).contexts[0]))
})

test('new names are added, not pushed out: an old name stays searchable while the newest come first, and compaction does not freeze settled values', () => {
  const store = new ContextStore(':memory:')
  store.seed([{ id: 'flat', title: '租房', summary: '新话题，尚无历史摘要。', entities: [], keywords: [], lastState: '' }])
  for (let round = 0; round < 6; round++)
    store.applyCard('flat', parseCard({ summary: '找房、签约、押金', aliases: Array.from({ length: 8 }, (_, i) => `叫法${round}-${i}`), settled: [`押金：${1000 + round}`], open: [] }, text => text)!, round + 1)
  const names = store.names('flat').get('flat')!
  assert.equal(names.length, 48, 'nothing pushed out')
  assert.ok(names[0].startsWith('叫法5-') && names.includes('叫法0-0'))
  // Compaction replaces the summary text; settled values still reach routing, current ones.
  store.updateSummary('flat', '压缩后的摘要：已经签约，在谈押金', store.contexts()[0].workingSessionId, 10, 20)
  store.applyCard('flat', parseCard({ summary: '卡片摘要', aliases: [], settled: ['押金：1800'], open: ['退不退中介费'] }, text => text)!, 99)
  const topic = store.contexts()[0]
  assert.equal(routingSummary(topic.summary, store.settled('flat'), store.openItems('flat')), '压缩后的摘要：已经签约，在谈押金 已定：押金：1800 待定：退不退中介费')
})

test('settled values keep when they were recorded and what they replaced; routing reads only the current value', () => {
  const store = new ContextStore(':memory:')
  store.seed([{ id: 'budget', title: '家庭月度记账', summary: '新话题，尚无历史摘要。', entities: [], keywords: [], lastState: '' }])
  const view = () => routingSummary(store.contexts()[0].summary, store.settled('budget'), store.openItems('budget'))
  store.applyCard('budget', parseCard({ summary: '每月记账，控制开销', aliases: [], entities: [], settled: ['月度目标：1500元', 7], open: [] }, text => text)!, 1000)
  assert.equal(view(), '每月记账，控制开销 已定：月度目标：1500元')
  store.applyCard('budget', parseCard({ summary: '每月记账，控制开销', aliases: [], entities: [], settled: ['月度目标：1600元', '记账工具：表格'], open: ['要不要记现金'] }, text => text)!, 2000)
  assert.deepEqual(store.settled('budget').find(item => item.label === '月度目标'), { label: '月度目标', value: '1600元', since: 2000, previous: '1500元', previousSince: 1000 })
  assert.equal(view(), '每月记账，控制开销 已定：月度目标：1600元；记账工具：表格 待定：要不要记现金')
  // A card that leaves a value out does not erase it; an unchanged value keeps its time.
  store.applyCard('budget', parseCard({ summary: '每月记账，控制开销', aliases: [], entities: [], settled: ['记账工具：表格'], open: [] }, text => text)!, 3000)
  assert.equal(store.settled('budget').find(item => item.label === '记账工具')?.since, 2000)
  assert.equal(store.settled('budget').find(item => item.label === '月度目标')?.value, '1600元')
  assert.deepEqual(store.openItems('budget'), [])
  assert.deepEqual(parseCard({ summary: 'x', settled: Array.from({ length: 9 }, (_, i) => `项${i}：${'值'.repeat(80)}`) }, text => text)!.settled.map(item => item.length), Array(6).fill(60))
  assert.deepEqual([...Array(30).keys()].filter(cardDue), [1, 4, 12, 20, 28])
})

test('after a topic’s first reply a card is written in the background, and routing sees it with the topic’s activity', { timeout: 60000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-cards-'))
  const model = new FixtureModel()
  const routed: { contexts: { id: string; keywords: string[]; activity?: string }[] }[] = []
  let cards = 0
  model.behavior = async function* (options) {
    const payload = () => JSON.parse((options.messages[0] as unknown as { content: { text: string }[] }).content[0].text)
    if (options.system?.startsWith(ROUTING_PROMPT)) {
      routed.push(payload())
      yield* textResponse(JSON.stringify({ action: 'EXISTING', contextId: 'ctx_qwen_9070xt', title: null, question: null, reason: 'named', historyIndependent: null, candidateIds: [], relatedIds: [] }))
      return
    }
    if (options.system === CARD_PROMPT) {
      cards++
      assert.ok(payload().conversation.some((turn: { role: string }) => turn.role === 'user'))
      yield* textResponse(JSON.stringify({ summary: '本地部署 Qwen 到 9070XT', aliases: ['显卡那件事'], entities: ['9070XT'], open: [] }))
      return
    }
    yield* textResponse('好')
  }
  const app = await harness(root, model, { routerMode: 'llm', theoneConfig: { topicCards: true } })
  try {
    await ask(app.gateway, 'Qwen 部署到 9070XT 怎么弄')
    await app.ctx.theone.extracting
    assert.equal(cards, 1)
    assert.equal(model.requests.find(r => r.system === CARD_PROMPT)?.sessionId,
      app.ctx.theone.store.contexts().find(context => context.id === 'ctx_qwen_9070xt')!.workingSessionId)
    assert.ok(app.ctx.theone.store.names('ctx_qwen_9070xt').get('ctx_qwen_9070xt')?.includes('显卡那件事'))
    await ask(app.gateway, '显卡那件事接着说一下驱动')
    await app.ctx.theone.extracting
    const qwen = routed.at(-1)!.contexts.find(context => context.id === 'ctx_qwen_9070xt')!
    assert.ok(qwen.keywords.includes('显卡那件事'))
    assert.equal(qwen.activity, '刚刚')
    // Only after the first reply, and later once more (the fourth); not on every turn.
    assert.equal(cards, 1)
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('an old topic is not ruled out for its age; time only orders otherwise equal topics', () => {
  assert.match(ROUTING_PROMPT, /不是排除理由/)
  assert.match(ROUTING_PROMPT, /「刚才那个」「继续」这类只靠时间的指代，优先最近活跃的话题/)
  assert.match(ROUTING_PROMPT, /以内容为准/)
  assert.doesNotMatch(ROUTING_PROMPT, /只有明确相关证据时才选它/)
})

test('a topic taken up after a long break starts from its last record, said as the last record', { timeout: 30000 }, async () => {
  const now = Date.UTC(2026, 9, 19)
  assert.equal(returnNote(undefined, now), '')
  assert.equal(returnNote(now - 2 * DAY, now), '')
  const note = returnNote(now - 40 * DAY, now)
  assert.match(note, /上次活动是 2026-09-09（40 天前）/)
  assert.match(note, /不一定今天仍然成立/)
  assert.match(note, /「上次记录是……」/)
  // Last active: the newer of its last routed message and the last thing in its own session.
  const root = await mkdtemp(join(tmpdir(), 'theone-return-'))
  const app = await harness(root)
  try {
    const service = app.ctx.theone as unknown as { lastActive(contextId: string, worker: unknown, inputId: string): number | undefined }
    const store = app.ctx.theone.store
    store.startTopicRun('m-old', 'ctx_qwen_9070xt', 's1', now - 40 * DAY)
    store.startTopicRun('m-now', 'ctx_qwen_9070xt', 's1', now)
    const worker = (time?: number) => ({ session: { snapshotEvents: () => time === undefined ? [] : [{ time }] } })
    assert.equal(service.lastActive('ctx_qwen_9070xt', worker(), 'm-now'), now - 40 * DAY)
    // The user worked in the topic directly last week.
    assert.equal(service.lastActive('ctx_qwen_9070xt', worker(now - 7 * DAY), 'm-now'), now - 7 * DAY)
    assert.equal(service.lastActive('ctx_nothing', worker(), 'm-now'), undefined)
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

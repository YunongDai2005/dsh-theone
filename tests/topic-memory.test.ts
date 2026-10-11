import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ContextStore } from '../src/store.ts'
import { routingPayload } from '../src/llm-router.ts'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ROUTING_PROMPT } from '../src/llm-router.ts'
import { activityLabel, CARD_PROMPT, learnDormancy, parseCard } from '../src/topic-memory.ts'
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
  assert.equal(topic.summary, '咖啡店秋季新品上线：定价、上新日期、宣传 待定：上新日期')
  assert.deepEqual(topic.keywords, ['咖啡店秋季上新', '上新日期', '南瓜拿铁'])
  assert.deepEqual(topic.entities, ['桂花冷萃'])
  const payload = routingPayload({ text: '上新日期得改', contexts: [{ ...topic, activity: '3 小时前' }] })
  assert.equal(payload.contexts[0].activity, '3 小时前')
  assert.ok(!('activity' in routingPayload({ text: 'x', contexts: [topic] }).contexts[0]))
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
    assert.ok(app.ctx.theone.store.contexts().find(context => context.id === 'ctx_qwen_9070xt')!.keywords.includes('显卡那件事'))
    await ask(app.gateway, '显卡那件事接着说一下驱动')
    await app.ctx.theone.extracting
    const qwen = routed.at(-1)!.contexts.find(context => context.id === 'ctx_qwen_9070xt')!
    assert.ok(qwen.keywords.includes('显卡那件事'))
    assert.equal(qwen.activity, '刚刚')
    // Only after the first reply, and later once more (the fourth); not on every turn.
    assert.equal(cards, 1)
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

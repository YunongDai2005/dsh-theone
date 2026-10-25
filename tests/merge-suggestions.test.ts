import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import UserQuestions, { UserQuestionError, type AskUserQuestionAnswer } from '@deepseek-ai/dsh-user-questions'
import type { AskUserQuestionRequestEvent } from '@deepseek-ai/dsh-user-questions/types'
import { ROUTING_PROMPT } from '../src/llm-router.ts'
import { CARD_PROMPT, type TopicCard } from '../src/topic-memory.ts'
import { ContextStore } from '../src/store.ts'
import * as policy from '../src/routing-policy.ts'
import { harness, ask, FixtureModel, textResponse } from './harness.ts'

test('the live idle gateway can emit and answer a userQuestions request outside a turn', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-merge-idle-'))
  const app = await harness(root)
  try {
    await app.ctx.plugin(UserQuestions)
    await ask(app.gateway, 'Qwen 那个')
    assert.equal(app.gateway.status, 'idle')
    const offset = app.gateway.session.snapshotEvents().length
    let emitted = false
    app.ctx.on('user-questions/request', async (request, next) => {
      if (request.agent !== app.gateway) return next()
      emitted = true
      assert.equal(app.gateway.status, 'idle')
      assert.equal(request.questions[0].question, 'Merge these topics?')
      return { answers: [{ id: 'idle-merge', selected: ['Merge'] }] }
    })
    const answer = await app.ctx.userQuestions.ask({ agent: app.gateway, signal: new AbortController().signal,
      questions: [{ id: 'idle-merge', header: 'Possible duplicate', question: 'Merge these topics?',
        options: [{ label: 'Merge' }, { label: 'Keep separate' }], multiSelect: false }] })
    assert.equal(emitted, true)
    assert.deepEqual(answer.answers, [{ id: 'idle-merge', selected: ['Merge'] }])
    assert.equal(app.gateway.session.snapshotEvents().slice(offset).some(event => event.type === 'turn/start'), false)
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})


const OLD = 'ctx_thesis', TITLE = '论文第三章'
const card: TopicCard = { summary: '毕业设计第三章', aliases: ['毕设'], entities: ['THESIS-2026'], settled: [], open: [] }
const labels = (request: AskUserQuestionRequestEvent) => request.questions[0].options!.map(option => option.label)
const select = (label: string): AskUserQuestionAnswer => ({ answers: [{ id: 'theone-route', selected: [label] }] })
const replies = (agent: Agent) => agent.session.snapshotEvents().flatMap(event => event.type === 'assistant/message' ? event.data.message.content.flatMap(block => block.type === 'text' ? [block.text] : []) : []).join('\n')
const pause = () => new Promise<void>(resolve => setImmediate(resolve))


async function fixture(options: { questions?: boolean; route?: 'manual' | 'imported'; beforeCard?: () => Promise<void> } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'theone-merge-'))
  const model = new FixtureModel()
  const app = await harness(root, model, { routerMode: 'llm', theoneConfig: { topicCards: true } })
  const store = app.ctx.theone.store
  store.applyCard(OLD, card)
  let existing: string | undefined
  if (options.route === 'manual') existing = store.createTopic(TITLE)
  if (options.route === 'imported') {
    store.importTopics('historical-session', undefined, [], [{ title: TITLE, summary: '历史中的论文', lastState: '', entities: [], keywords: [], contextId: null, turns: [], groupId: null, groupTitle: null, groupSummary: '' }])
    existing = store.contexts().find(topic => topic.title === TITLE)!.id
  }
  const prompts: AskUserQuestionRequestEvent[] = []
  let answer: (request: AskUserQuestionRequestEvent) => AskUserQuestionAnswer | undefined | Promise<AskUserQuestionAnswer | undefined> = request => select(labels(request)[2])
  if (options.questions !== false) {
    await app.ctx.plugin(UserQuestions)
    app.ctx.on('user-questions/request', async (request, next) => {
      if (!request.agent || !store.isGateway(request.agent.id)) return next()
      prompts.push(request)
      return await answer(request) as AskUserQuestionAnswer
    })
  }
  let currentCard = card
  let workerGate: (() => Promise<void>) | undefined
  model.behavior = async function* (request) {
    if (request.system?.startsWith(ROUTING_PROMPT)) {
      yield* textResponse(JSON.stringify(existing ? { action: 'EXISTING', contextId: existing, reason: 'fixture' }
        : { action: 'CREATE', title: TITLE, historyIndependent: true, reason: 'fixture' }))
      return
    }
    if (request.system === CARD_PROMPT) { await options.beforeCard?.(); yield* textResponse(JSON.stringify(currentCard)); return }
    await workerGate?.()
    yield* textResponse('正文回答')
  }
  const service = app.ctx.theone as unknown as { mergePromptTasks?: Map<string, Promise<void>>; queueCard(worker: unknown, contextId: string): void }
  const newId = () => existing ?? store.contexts().find(topic => topic.title === TITLE)?.id ?? store.merges().find(merge => merge.title === TITLE)!.sourceId
  return { ...app, root, prompts, store, newId,
    setCard: (value: TopicCard) => { currentCard = value },
    choose: (choose: typeof answer) => { answer = choose }, holdWorker: (gate?: () => Promise<void>) => { workerGate = gate },
    start: async (text = '帮我写第三章') => {
      const result = await ask(app.gateway, text)
      existing = store.route(result.input.id)!.decision.contextId
      await app.ctx.theone.extracting
      return result
    },
    drain: async () => { await pause(); await Promise.all(service.mergePromptTasks?.values() ?? []); await app.gateway.whenIdle() },
    rewrite: async () => {
      const id = newId(), topic = store.contexts().find(topic => topic.id === id)!
      await ask(app.gateway, '请完善第三章内容')
      service.queueCard(app.ctx.agents.get(SessionId(topic.workingSessionId)), id)
      await app.ctx.theone.extracting
    },
    close: async () => { await app.close(); await rm(root, { recursive: true, force: true }) },
  }
}

for (const [index, answer] of [[0, 'merged'], [1, 'merged'], [2, 'declined']] as const) {
  test(`first routed card choice ${index} persists ${answer} and uses the selected merge direction`, { timeout: 30000 }, async () => {
    const app = await fixture()
    let removedWorker: string | undefined
    try {
      app.choose(request => {
        assert.equal(app.gateway.status, 'idle', 'a background question never interrupts a turn')
        assert.equal(request.questions[0].header, '可能重复')
        assert.equal(request.questions[0].question, '「论文第三章」和「Video Attention Thesis」好像是同一件事，要合并吗？')
        assert.equal(request.questions[0].detail, '合并后可以在话题卡片上撤销。')
        assert.deepEqual(labels(request), ['合并到「Video Attention Thesis」', '合并到「论文第三章」', '不是一回事'])
        if (index === 0) removedWorker = app.store.contexts().find(topic => topic.id === app.newId())!.workingSessionId
        return select(labels(request)[index])
      })
      await app.start(); await app.drain()
      assert.equal(app.prompts.length, 1)
      const id = app.newId()
      assert.equal(app.store.mergePrompt(id, OLD)?.answer, answer)
      if (index < 2) {
        const source = index === 0 ? id : OLD, target = index === 0 ? OLD : id
        assert.deepEqual(app.store.merges().map(merge => [merge.sourceId, merge.targetId]), [[source, target]])
        assert.ok(app.store.contexts().some(topic => topic.id === target))
        if (removedWorker) assert.equal(app.ctx.agents.get(SessionId(removedWorker)), undefined, 'the merged Worker is disposed')
        const notices = app.gateway.session.snapshotEvents().filter(event => event.type === 'assistant/message')
        assert.ok(JSON.stringify(notices).includes(`已合并到「${index === 0 ? 'Video Attention Thesis' : TITLE}」`))
        app.store.unmergeTopic(source)
        assert.equal(app.store.mergePrompt(OLD, id)?.answer, 'merged')
      }
      await app.rewrite(); await app.drain()
      assert.equal(app.prompts.length, 1, 'rewrites and unmerge never repeat the question')
    } finally { await app.close() }
  })
}

for (const route of ['manual', 'imported'] as const) {
  test(`${route} topics do not acquire a merge question on their first card`, { timeout: 30000 }, async () => {
    const app = await fixture({ route })
    try { await app.start(); await app.drain(); assert.equal(app.prompts.length, 0) }
    finally { await app.close() }
  })
}

for (const failure of ['missing', 'cancelled', 'empty', 'timeout', 'no-answerer', 'custom'] as const) {
  test(`merge question ${failure} is dismissed permanently without merging`, { timeout: 30000 }, async () => {
    const app = await fixture({ questions: failure !== 'missing' })
    try {
      app.choose(() => {
        if (failure === 'no-answerer') throw new UserQuestionError('none', 'NO_PROVIDER')
        if (failure === 'timeout') throw new UserQuestionError('timeout', 'ASK_TIMED_OUT')
        if (failure === 'cancelled') return undefined
        return { answers: failure === 'custom' ? [{ id: 'theone-route', selected: [], custom: 'something else' }] : [] }
      })
      await app.start(); await app.drain()
      const before = app.prompts.length
      assert.equal(app.store.mergePrompt(app.newId(), OLD)?.answer, 'dismissed')
      assert.equal(app.store.merges().length, 0)
      await app.rewrite(); await app.drain()
      assert.equal(app.prompts.length, before)
    } finally { await app.close() }
  })
}

test('a card ready during a reply waits through another queued message and uses the latest user language', { timeout: 30000 }, async () => {
  const cardReady = Promise.withResolvers<void>(), releaseCard = Promise.withResolvers<void>()
  const app = await fixture({ beforeCard: async () => { cardReady.resolve(); await releaseCard.promise } })
  const workerEntered = Promise.withResolvers<void>(), releaseWorker = Promise.withResolvers<void>()
  try {
    const first = app.start()
    await cardReady.promise
    app.holdWorker(async () => { workerEntered.resolve(); await releaseWorker.promise })
    const second = ask(app.gateway, 'Please continue the chapter')
    await workerEntered.promise
    releaseCard.resolve()
    await app.ctx.theone.extracting
    assert.equal(app.prompts.length, 0)
    const third = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Please explain the result too' }] })
    app.gateway.inbox.append('next-turn', third)
    app.choose(request => {
      assert.equal(app.gateway.status, 'idle')
      assert.equal(request.questions[0].header, 'Possible duplicate')
      assert.equal(request.questions[0].question, '"论文第三章" and "Video Attention Thesis" look like the same thing. Merge them?')
      assert.equal(request.questions[0].detail, 'You can undo a merge from the topic card.')
      assert.deepEqual(labels(request), ['Merge into "Video Attention Thesis"', 'Merge into "论文第三章"', 'Not the same'])
      assert.equal(request.questions[0].options![0].description, 'Keep "Video Attention Thesis" and fold "论文第三章" into it')
      assert.equal(request.questions[0].options![2].description, "Don't ask about these two again")
      return select(labels(request)[0])
    })
    releaseWorker.resolve()
    await first; await second; await app.gateway.whenIdle(); await app.drain()
    assert.equal(app.prompts.length, 1)
    assert.equal(app.store.mergePrompt(app.newId(), OLD)?.answer, 'merged')
    assert.match(replies(app.gateway), /Merged into "Video Attention Thesis"/)
  } finally { releaseCard.resolve(); releaseWorker.resolve(); await app.close() }
})

test('a pending question does not prevent a new user turn and a busy merge waits then succeeds', { timeout: 30000 }, async () => {
  const app = await fixture()
  const questionReady = Promise.withResolvers<void>(), answer = Promise.withResolvers<AskUserQuestionAnswer>()
  const workerEntered = Promise.withResolvers<void>(), releaseWorker = Promise.withResolvers<void>()
  try {
    app.choose(request => { questionReady.resolve(); return answer.promise })
    await app.start(); await questionReady.promise
    app.holdWorker(async () => { workerEntered.resolve(); await releaseWorker.promise })
    const next = ask(app.gateway, '继续')
    await workerEntered.promise
    answer.resolve(select(labels(app.prompts[0])[0]))
    await pause()
    assert.equal(app.store.merges().length, 0)
    releaseWorker.resolve()
    await next; await app.drain()
    assert.equal(app.store.mergePrompt(app.newId(), OLD)?.answer, 'merged')
  } finally { releaseWorker.resolve(); answer.resolve({ answers: [] }); await app.close() }
})

for (const action of ['move', 'delete', 'merge'] as const) {
  test(`a routed topic ${action} before its first card is not suggested`, { timeout: 30000 }, async () => {
    const ready = Promise.withResolvers<void>(), release = Promise.withResolvers<void>()
    const app = await fixture({ beforeCard: async () => { ready.resolve(); await release.promise } })
    try {
      const pending = app.start()
      await ready.promise
      const id = app.newId()
      if (action === 'move') app.store.moveTopic(id, { title: '用户自己的工作区' })
      if (action === 'delete') app.store.deleteTopic(id)
      if (action === 'merge') app.store.mergeTopics(id, OLD)
      release.resolve(); await pending; await app.drain()
      assert.equal(app.prompts.length, 0)
    } finally { release.resolve(); await app.close() }
  })
}

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

test('a first card with no duplicate consumes the check even if a later card becomes similar', { timeout: 30000 }, async () => {
  const app = await fixture()
  try {
    app.setCard({ summary: '完全独立的事', aliases: [], entities: [], settled: [], open: [] })
    await app.start(); await app.drain()
    assert.equal(app.prompts.length, 0)
    app.setCard(card)
    await app.rewrite(); await app.drain()
    assert.equal(app.prompts.length, 0)
  } finally { await app.close() }
})

test('candidate selection prefers more exact names, then activity, excluding hidden and previously asked pairs', { timeout: 30000 }, async () => {
  const ready = Promise.withResolvers<void>(), release = Promise.withResolvers<void>()
  const app = await fixture({ beforeCard: async () => { ready.resolve(); await release.promise } })
  try {
    const first = app.start()
    await ready.promise
    for (const [id, title, entities, at] of [
      ['weaker', '刚活动过的分支', ['毕设', 'THESIS-2026'], 9000],
      ['older', '旧主线', [TITLE, '毕设', 'THESIS-2026'], 100],
      ['newer', '最近主线', [TITLE, '毕设', 'THESIS-2026'], 200],
      ['hidden', '已排除的主线', [TITLE, '毕设', 'THESIS-2026'], 9999],
      ['asked', '已问过的主线', [TITLE, '毕设', 'THESIS-2026'], 99999],
    ] as const) {
      app.store.seed([{ id, title, entities: [...entities], summary: title, lastState: '', keywords: [] }])
      app.store.startTopicRun(`run:${id}`, id, `session:${id}`, at)
      app.store.endTopicRun(`run:${id}`, 'completed', at)
    }
    app.store.replaceHidden([{ id: 'hidden', reason: 'excluded' }])
    app.store.recordMergePrompt(app.newId(), 'asked', 'declined')
    release.resolve(); await first; await app.drain()
    assert.equal(app.prompts.length, 1)
    assert.equal(labels(app.prompts[0])[0], '合并到「最近主线」')
    assert.equal(app.store.mergePrompt(app.newId(), 'newer')?.answer, 'declined')
    assert.equal(app.store.mergePrompt(app.newId(), OLD), undefined)
  } finally { release.resolve(); await app.close() }
})

test('an asked pair is not offered even on the first card, and failed cards do not consume the check', { timeout: 30000 }, async () => {
  const ready = Promise.withResolvers<void>(), release = Promise.withResolvers<void>()
  const app = await fixture({ beforeCard: async () => { ready.resolve(); await release.promise } })
  try {
    const first = app.start()
    await ready.promise
    app.store.recordMergePrompt(app.newId(), OLD, 'dismissed')
    release.resolve(); await first; await app.drain()
    assert.equal(app.prompts.length, 0)
  } finally { release.resolve(); await app.close() }
  const retry = await fixture()
  try {
    retry.setCard({ ...card, summary: '' })
    await retry.start(); await retry.drain()
    assert.equal(retry.prompts.length, 0)
    retry.setCard(card)
    await retry.rewrite(); await retry.drain()
    assert.equal(retry.prompts.length, 1)
  } finally { await retry.close() }
})

test('thirty minutes without an idle main chat dismisses without asking', { timeout: 30000 }, async t => {
  const ready = Promise.withResolvers<void>(), releaseCard = Promise.withResolvers<void>()
  const entered = Promise.withResolvers<void>(), releaseWorker = Promise.withResolvers<void>()
  const app = await fixture({ beforeCard: async () => { ready.resolve(); await releaseCard.promise } })
  try {
    const first = app.start(); await ready.promise
    app.holdWorker(async () => { entered.resolve(); await releaseWorker.promise })
    const next = ask(app.gateway, '继续')
    await entered.promise
    releaseCard.resolve(); await app.ctx.theone.extracting
    const tasks = (app.ctx.theone as unknown as { mergePromptTasks: Map<string, Promise<void>> }).mergePromptTasks
    assert.equal(tasks.size, 1)
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() + 30 * 60 * 1000 + 1 })
    await Promise.all(tasks.values())
    assert.equal(app.prompts.length, 0)
    assert.equal(app.store.mergePrompt(app.newId(), OLD)?.answer, 'dismissed')
    t.mock.timers.reset()
    releaseWorker.resolve(); await first; await next; await app.drain()
  } finally { t.mock.timers.reset(); releaseCard.resolve(); releaseWorker.resolve(); await app.close() }
})

test('a failed retry records dismissal and posts the failure after the active turn without a model call', { timeout: 30000 }, async t => {
  const app = await fixture()
  const asked = Promise.withResolvers<void>(), answer = Promise.withResolvers<AskUserQuestionAnswer>()
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>()
  try {
    app.choose(() => { asked.resolve(); return answer.promise })
    await app.start(); await asked.promise
    app.holdWorker(async () => { entered.resolve(); await release.promise })
    const next = ask(app.gateway, '继续')
    await entered.promise
    t.mock.method(app.store, 'mergeTopics', () => { throw new Error('synthetic write failure') })
    answer.resolve(select(labels(app.prompts[0])[0]))
    await pause()
    assert.equal(app.store.merges().length, 0)
    const calls = app.model.requests.length
    release.resolve(); await next; await app.drain()
    assert.equal(app.store.merges().length, 0)
    assert.equal(app.store.mergePrompt(app.newId(), OLD)?.answer, 'dismissed')
    assert.equal(app.model.requests.length, calls, 'the failure notice uses no model')
    assert.match(replies(app.gateway), /这次没合并成，可以在话题工作区手动合并/)
  } finally { answer.resolve({ answers: [] }); release.resolve(); await app.close() }
})

test('moving the topic while a chosen merge waits for a busy turn cancels that merge', { timeout: 30000 }, async () => {
  const app = await fixture()
  const asked = Promise.withResolvers<void>(), answer = Promise.withResolvers<AskUserQuestionAnswer>()
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>()
  try {
    app.choose(() => { asked.resolve(); return answer.promise })
    await app.start(); await asked.promise
    app.holdWorker(async () => { entered.resolve(); await release.promise })
    const next = ask(app.gateway, '继续')
    await entered.promise
    answer.resolve(select(labels(app.prompts[0])[0]))
    await pause()
    app.store.moveTopic(app.newId(), { title: '用户整理的地方' })
    release.resolve(); await next; await app.drain()
    assert.equal(app.store.merges().length, 0)
    assert.equal(app.store.mergePrompt(app.newId(), OLD)?.answer, 'dismissed')
  } finally { answer.resolve({ answers: [] }); release.resolve(); await app.close() }
})

test('a timed out merge wait still reports failure when the main chat becomes idle', { timeout: 30000 }, async t => {
  const app = await fixture()
  const asked = Promise.withResolvers<void>(), answer = Promise.withResolvers<AskUserQuestionAnswer>()
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>()
  try {
    app.choose(() => { asked.resolve(); return answer.promise })
    await app.start(); await asked.promise
    app.holdWorker(async () => { entered.resolve(); await release.promise })
    const next = ask(app.gateway, '继续')
    await entered.promise
    answer.resolve(select(labels(app.prompts[0])[0]))
    await pause()
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() + 30 * 60 * 1000 + 1 })
    await new Promise(resolve => setTimeout(resolve, 150))
    t.mock.timers.reset()
    release.resolve(); await next; await app.drain()
    assert.equal(app.store.merges().length, 0)
    assert.equal(app.store.mergePrompt(app.newId(), OLD)?.answer, 'dismissed')
    assert.match(replies(app.gateway), /这次没合并成，可以在话题工作区手动合并/)
  } finally { t.mock.timers.reset(); answer.resolve({ answers: [] }); release.resolve(); await app.close() }
})

test('a pending background question cannot hang shutdown even if its answerer ignores cancellation', { timeout: 30000 }, async () => {
  const app = await fixture()
  const entered = Promise.withResolvers<void>(), answer = Promise.withResolvers<AskUserQuestionAnswer>()
  let closing: Promise<void> | undefined
  try {
    app.choose(() => { entered.resolve(); return answer.promise })
    await app.start(); await entered.promise
    closing = app.close()
    const stopped = await Promise.race([closing.then(() => true), new Promise<boolean>(resolve => setTimeout(() => resolve(false), 1000))])
    assert.equal(stopped, true)
  } finally { answer.resolve({ answers: [] }); await (closing ?? app.close()) }
})

test('the suggestion goes to the topic last routed gateway, not the one that created it', { timeout: 30000 }, async () => {
  const ready = Promise.withResolvers<void>(), release = Promise.withResolvers<void>()
  const app = await fixture({ beforeCard: async () => { ready.resolve(); await release.promise } })
  try {
    const first = app.start(); await ready.promise
    const second = (await app.ctx.agents.create({ sessionId: SessionId('merge-second-gateway'), agentOptions: { provider: 'theone', model: 'gateway' } })).agent
    await ask(second, '请接着写第三章内容')
    release.resolve(); await first; await app.drain()
    assert.equal(app.prompts.length, 1)
    assert.equal(app.prompts[0].agent, second)
    assert.equal(app.store.mergePrompt(app.newId(), OLD)?.answer, 'declined')
  } finally { release.resolve(); await app.close() }
})

test('long colliding merge labels stay unique and the shortened second label keeps its direction', { timeout: 30000 }, async () => {
  const ready = Promise.withResolvers<void>(), release = Promise.withResolvers<void>()
  const app = await fixture({ beforeCard: async () => { ready.resolve(); await release.promise } })
  try {
    const first = app.start(); await ready.promise
    const id = app.newId()
    app.store.editTopic(OLD, { title: '长'.repeat(60) })
    app.store.editTopic(id, { title: '长'.repeat(59) + '异' })
    app.choose(request => {
      const options = labels(request)
      assert.equal(new Set(options).size, 3)
      assert.ok(options.every(label => [...label].length <= 40))
      assert.ok(options[0].includes('…'))
      assert.ok(options[1].endsWith('（2）'))
      return select(options[1])
    })
    release.resolve(); await first; await app.drain()
    assert.deepEqual(app.store.merges().map(merge => [merge.sourceId, merge.targetId]), [[OLD, id]])
  } finally { release.resolve(); await app.close() }
})

test('deleting a candidate while the question is open clears its reservation and a late answer cannot restore it', { timeout: 30000 }, async () => {
  const app = await fixture()
  try {
    app.choose(request => {
      app.store.deleteTopic(OLD)
      return select(labels(request)[0])
    })
    await app.start(); await app.drain()
    assert.equal(app.store.merges().length, 0)
    assert.equal(app.store.mergePrompt(app.newId(), OLD), undefined)
  } finally { await app.close() }
})

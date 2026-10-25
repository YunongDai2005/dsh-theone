import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ToolCallId, type GenerateOptions } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import UserQuestions, { UserQuestionError, type AskUserQuestionAnswer } from '@deepseek-ai/dsh-user-questions'
import type { AskUserQuestionRequestEvent } from '@deepseek-ai/dsh-user-questions/types'
import type { ApprovalOutcome, ApprovalRequestEvent } from '@deepseek-ai/dsh-user-approval/types'
import { ROUTING_PROMPT } from '../src/llm-router.ts'
import { harness, ask, FixtureModel, textResponse } from './harness.ts'

const A = 'ctx_qwen_9070xt', B = 'ctx_thesis'
const requestText = 'Qwen 和论文的进度整理到笔记里'
const topicOf = (options: GenerateOptions) => {
  const message = options.messages.findLast(message => 'source' in message && message.source?.kind === 'theone-context')
  return message && 'source' in message && message.source?.kind === 'theone-context' ? message.source.contextId : undefined
}
const select = (label: string): AskUserQuestionAnswer => ({ answers: [{ id: 'theone-route', selected: [label] }] })
const custom = (text: string): AskUserQuestionAnswer => ({ answers: [{ id: 'theone-route', selected: [], custom: text }] })
const labels = (request: AskUserQuestionRequestEvent) => request.questions[0].options!.map(option => option.label)

/** Only the model and the human answerer are synthetic; the DSH question service and loop are real. */
async function fixture(options: { editing?: boolean; questions?: boolean; history?: boolean; llm?: boolean; path?: string } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'theone-route-options-'))
  const model = new FixtureModel()
  const app = await harness(root, model, { routerMode: options.llm ? 'llm' : 'rules', historyCatalog: options.history })
  const prompts: AskUserQuestionRequestEvent[] = [], approvals: ApprovalRequestEvent[] = [], edits: string[] = []
  let answer: (request: AskUserQuestionRequestEvent) => Promise<AskUserQuestionAnswer | undefined> | AskUserQuestionAnswer | undefined = request => select(labels(request)[0])
  let approval: ApprovalOutcome = 'allowed-once'
  app.ctx.provide('approval')
  app.ctx.set('approval', { request: async (request: ApprovalRequestEvent) => { approvals.push(request); return approval } } as never)
  if (options.questions !== false) {
    await app.ctx.plugin(UserQuestions)
    app.ctx.on('user-questions/request', async (request, next) => {
      if (request.agent !== app.gateway) return next()
      prompts.push(request)
      return await answer(request) as AskUserQuestionAnswer
    })
  }
  app.ctx.tools.register(defineTool({ name: 'edit', description: 'Synthetic edit', parameters: { file_path: { type: 'string', required: true } },
    output: { schema: { type: 'string' }, render: (_args, value: string) => [{ type: 'text', text: value }] },
    execute: async (_args, exec) => { edits.push(exec.agent!.id); return 'edited' } }))
  model.behavior = async function* (request) {
    if (request.system?.startsWith(ROUTING_PROMPT)) {
      // A historical reference makes this a real unresolved correction even with no candidates.
      const payload = JSON.parse(request.messages[0].content.filter(block => block.type === 'text').map(block => block.text).join('')) as { contexts: { id: string }[] }
      yield* textResponse(JSON.stringify({ action: 'CLARIFY', contextId: null, title: null, question: 'Which one?', reason: 'unsure',
        candidateIds: payload.contexts.some(context => context.id === A) ? [A, B] : [] }))
      return
    }
    if (!topicOf(request)) { yield* textResponse('[]'); return } // correction-term extraction
    const lastUser = request.messages.findLastIndex(message => message.role === 'user' && 'source' in message && message.source?.kind === 'user')
    const results = request.messages.slice(lastUser + 1).filter(message => message.role === 'tool')
    if (options.editing !== false && results.length < 2 && !results.some(message => 'isError' in message && message.isError)) {
      const id = ToolCallId(`${topicOf(request)}-edit-${results.length}`)
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'edit', arguments: JSON.stringify({ file_path: options.path ?? 'notes.md' }) } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    } else yield* textResponse(`answer:${topicOf(request)}`)
  }
  return { ...app, root, prompts, approvals, edits,
    choose: (choose: typeof answer) => { answer = choose }, approve: (value: ApprovalOutcome) => { approval = value },
    workerId: (id: string) => app.ctx.theone.store.contexts().find(context => context.id === id)!.workingSessionId,
    close: async () => { await app.close(); await rm(root, { recursive: true, force: true }) },
  }
}

test('target choices stay in A once per message and mark its work as waiting for the user', { timeout: 30000 }, async () => {
  const app = await fixture()
  try {
    app.choose(request => {
      assert.equal(request.agent, app.gateway)
      assert.equal(request.questions[0].id, 'theone-route')
      assert.equal(request.questions[0].multiSelect, false)
      assert.deepEqual(labels(request), ['就在「Qwen / RX 9070 XT」里做', '其实是「Video Attention Thesis」的', '新开一个话题'])
      const service = app.ctx.theone as unknown as { topicStates(): Map<string, { status: string }> }
      assert.equal(service.topicStates().get(A)?.status, 'waiting')
      return select(labels(request)[0])
    })
    const result = await ask(app.gateway, requestText)
    assert.equal(result.output, `answer:${A}`)
    assert.equal(app.prompts.length, 1)
    assert.equal(app.approvals.length, 0)
    assert.deepEqual(app.edits, [app.workerId(A), app.workerId(A)])
    assert.equal(app.ctx.theone.store.hasFlag(`target:${result.input.id}`), true)
  } finally { await app.close() }
})

test('choosing B denies A, shows B in main chat, excludes A history and teaches B', { timeout: 30000 }, async () => {
  const app = await fixture()
  try {
    app.choose(request => select(labels(request)[1]))
    const result = await ask(app.gateway, requestText)
    assert.equal(result.end?.data.reason.kind, 'completed')
    assert.equal(result.output, `answer:${B}`)
    assert.deepEqual(app.edits, [app.workerId(B), app.workerId(B)])
    assert.equal(app.approvals.length, 0)
    const store = app.ctx.theone.store
    assert.equal(store.route(result.input.id)?.decision.contextId, B)
    assert.equal(store.current('test-gateway'), B)
    assert.equal(store.topicRun(result.input.id)?.contextId, B)
    const worker = app.ctx.agents.get(SessionId(app.workerId(A)))!
    await worker.whenIdle()
    // Misroute recording follows settlement, like the existing hand-back path.
    for (let i = 0; !store.misroutes(A).length && i < 100; i++) await new Promise(resolve => setImmediate(resolve))
    assert.equal(store.misroutes(A).length, 1)
    assert.ok(store.excludedRanges(worker.id).length > 0)
    assert.equal((await app.ctx.theone.searchHistoryDetailed(A, '笔记')).windows.length, 0)
    await app.ctx.theone.learning
    assert.ok((store.learnedTerms().get(B) ?? []).includes('进度整理到笔记里'))
    assert.equal(store.hasFlag(`misroute:${result.input.id}`), true)
    assert.equal(store.hasFlag(`handback:${result.input.id}`), true)
    const denied = worker.session.snapshotEvents().find(event => event.type === 'tool/result')
    assert.ok(denied?.type === 'tool/result' && JSON.stringify(denied.data).includes('Do not change anything'))
  } finally { await app.close() }
})

test('target choices can create an independent topic and give it the original message', { timeout: 30000 }, async () => {
  const app = await fixture()
  try {
    app.choose(request => select(labels(request).at(-1)!))
    const result = await ask(app.gateway, requestText)
    const decision = app.ctx.theone.store.route(result.input.id)!.decision
    assert.equal(decision.action, 'CREATE')
    assert.equal(decision.historyIndependent, true)
    assert.equal(decision.title, requestText)
    assert.notEqual(decision.contextId, A)
    assert.notEqual(decision.contextId, B)
    assert.equal(result.output, `answer:${decision.contextId}`)
    assert.deepEqual(app.edits, [app.workerId(decision.contextId!), app.workerId(decision.contextId!)])
  } finally { await app.close() }
})

for (const [hint, expected] of [['是论文的', B], ['不认识的那件事', A]] as const) {
  test(`target Other uses the reroute hint: ${hint}`, { timeout: 30000 }, async () => {
    const app = await fixture()
    try {
      app.choose(() => custom(hint))
      const result = await ask(app.gateway, requestText)
      assert.equal(app.ctx.theone.store.route(result.input.id)?.decision.contextId, expected)
      assert.equal(result.output, `answer:${expected}`)
      assert.equal(app.edits.length, expected === B ? 2 : 0)
      assert.equal(app.approvals.length, 0, 'an unresolved typed correction denies rather than approving A')
    } finally { await app.close() }
  })
}

for (const failure of ['missing', 'empty', 'empty-selection', 'unknown-label', 'cancelled', 'ASK_ABORTED', 'ASK_TIMED_OUT', 'CALLER_NOT_LIVE', 'DELEGATED_CALLER', 'NO_PROVIDER']) {
  test(`target question ${failure} falls back to the existing approval`, { timeout: 30000 }, async () => {
    const app = await fixture({ questions: failure !== 'missing' })
    try {
      app.choose(() => {
        if (failure === 'empty') return { answers: [] }
        if (failure === 'empty-selection') return { answers: [{ id: 'theone-route', selected: [] }] }
        if (failure === 'unknown-label') return select('not an offered option')
        if (failure === 'cancelled') return undefined
        throw new UserQuestionError('synthetic unavailable answerer', failure)
      })
      const result = await ask(app.gateway, requestText)
      assert.equal(result.output, `answer:${A}`)
      assert.equal(app.prompts.length, failure === 'missing' ? 0 : 1)
      assert.equal(app.approvals.length, 1)
      assert.equal(app.approvals[0].agent, app.gateway)
      assert.deepEqual(app.edits, [app.workerId(A), app.workerId(A)])
    } finally { await app.close() }
  })
}

for (const outcome of ['rejected', 'cancelled', 'unavailable'] as const) {
  test(`target fallback preserves approval outcome ${outcome}`, { timeout: 30000 }, async () => {
    const app = await fixture({ questions: false })
    try {
      app.approve(outcome)
      await ask(app.gateway, requestText)
      assert.ok(app.approvals.length > 0)
      assert.equal(app.edits.length, outcome === 'unavailable' ? 2 : 0)
    } finally { await app.close() }
  })
}

test('a different project folder without alternate topics still uses approval', { timeout: 30000 }, async () => {
  const app = await fixture({ path: 'other-project/notes.md' })
  try {
    // The fixture topic starts in <root>/gateway, so this relative path belongs to the other project.
    const other = join(app.root, 'gateway', 'other-project')
    await mkdir(other, { recursive: true })
    app.ctx.provide('workspaceRegistry')
    app.ctx.set('workspaceRegistry', { list: () => [{ path: other }], archivedSessionIds: [], archiveSession: async () => {}, unarchiveSession: async () => {} } as never)
    await ask(app.gateway, 'Qwen 的笔记整理一下')
    assert.equal(app.prompts.length, 0)
    assert.equal(app.approvals.length, 1)
    assert.match(app.approvals[0].displayReason!.zh!, /other-project/)
    assert.equal(app.edits.length, 2)
  } finally { await app.close() }
})

test('a message already handed back offers no choices and keeps the approval path', { timeout: 30000 }, async () => {
  const app = await fixture()
  try {
    app.ctx.on('agent/assistant-stream', ({ agent, frame }) => {
      if (agent.id !== app.gateway.id && frame.type === 'start') {
        const run = app.ctx.theone.store.recentRoutes('test-gateway', 1)[0]
        if (run) app.ctx.theone.store.markOnce(`handback:${run.messageId}`)
      }
    })
    await ask(app.gateway, requestText)
    assert.equal(app.prompts.length, 0)
    assert.equal(app.approvals.length, 1)
    assert.equal(app.edits.length, 2)
  } finally { await app.close() }
})

for (const failure of ['busy', 'deleted'] as const) {
  test(`target handoff to a ${failure} topic rolls back and continues in A`, { timeout: 30000 }, async () => {
    const app = await fixture()
    try {
      if (failure === 'busy') {
        await ask(app.gateway, '论文的笔记整理一下')
        app.edits.length = 0
        app.ctx.theone.store.mount('test-gateway', A)
        const worker = app.ctx.agents.get(SessionId(app.workerId(B)))!
        worker.inbox.append('next-turn', { id: 'busy-input', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'pending' }] } as never)
      }
      app.choose(request => {
        if (failure === 'deleted') app.ctx.theone.store.deleteTopic(B)
        return select(labels(request)[1])
      })
      const result = await ask(app.gateway, requestText)
      assert.equal(result.output, `answer:${A}`)
      assert.equal(app.ctx.theone.store.route(result.input.id)?.decision.contextId, A)
      assert.equal(app.ctx.theone.store.current('test-gateway'), A)
      assert.equal(app.ctx.theone.store.topicRun(result.input.id)?.contextId, A)
      assert.equal(app.ctx.theone.store.misroutes(A).length, 0)
      assert.deepEqual(app.edits, [app.workerId(A), app.workerId(A)])
      assert.equal(app.approvals.length, 0)
    } finally { await app.close() }
  })
}

test('target choices filter excluded, missing and repeated alternatives, limiting alternatives to three', { timeout: 30000 }, async () => {
  const app = await fixture()
  try {
    const store = app.ctx.theone.store
    store.seed(['C', 'D', 'E', 'F'].map(id => ({ id, title: id, summary: id, lastState: id, entities: [], keywords: [] })))
    store.replaceHidden([{ id: 'C', reason: 'excluded' }])
    app.ctx.on('agent/assistant-stream', ({ agent, frame }) => {
      if (agent.id === app.gateway.id || frame.type !== 'start') return
      const route = store.recentRoutes('test-gateway', 1)[0]
      if (route && !store.hasFlag(`target:${route.messageId}`)) store.moveRoute(route.messageId, 'test-gateway',
        { ...route.decision, alternateIds: [A, 'missing', 'C', B, B, 'D', 'E', 'F'] })
    })
    await ask(app.gateway, requestText)
    assert.deepEqual(labels(app.prompts[0]), ['就在「Qwen / RX 9070 XT」里做', '其实是「Video Attention Thesis」的', '其实是「D」的', '其实是「E」的', '新开一个话题'])
  } finally { await app.close() }
})

/** In LLM mode this historical reference settles in A; rerouting it explicitly remains unclear. */
const oldRequest = '继续上次那个配置的笔记'

test('unclear correction asks the live gateway during pre-step and uses the ordinary correction flow', { timeout: 30000 }, async () => {
  const app = await fixture({ editing: false, llm: true })
  try {
    const first = await ask(app.gateway, oldRequest)
    app.choose(request => {
      assert.equal(request.agent, app.gateway)
      assert.ok(app.ctx.agents.roots().includes(app.gateway))
      const original = app.ctx.theone.store.route(first.input.id)
      assert.equal(original?.status, 'completed')
      assert.equal(request.wait, undefined, 'a routing question has no tool wait to attach to')
      const events = app.gateway.session.snapshotEvents()
      const currentTurn = events.slice(events.findLastIndex(event => event.type === 'turn/start'))
      assert.ok(!currentTurn.some(event => event.type === 'request/header'), 'asked before the gateway model request')
      assert.equal(request.questions[0].header, '分错了')
      return select('Video Attention Thesis')
    })
    const fixed = await ask(app.gateway, '分错了')
    assert.equal(app.prompts.length, 1, 'real UserQuestions.ask accepted the gateway before its model request')
    assert.equal(fixed.output, `answer:${B}`)
    assert.deepEqual(app.ctx.theone.store.route(fixed.input.id)?.decision,
      { action: 'MOUNT', contextId: B, reason: 'correction', correctionOf: first.input.id })
    assert.equal(app.ctx.theone.store.recentRoutes('test-gateway').find(route => route.messageId === first.input.id)?.correctedTo, B)
    const workerRequest = app.model.requests.findLast(request => topicOf(request) === B)!
    assert.match(JSON.stringify(workerRequest.messages), /继续上次那个配置的笔记/)
    assert.match(JSON.stringify(workerRequest.messages), /用户的更正：分错了/)
    await app.ctx.theone.learning
    assert.ok((app.ctx.theone.store.learnedTerms().get(B) ?? []).length > 0)
  } finally { await app.close() }
})

test('unclear correction can create a topic for the original text', { timeout: 30000 }, async () => {
  const app = await fixture({ editing: false, llm: true })
  try {
    const first = await ask(app.gateway, oldRequest)
    app.choose(request => select(labels(request).at(-1)!))
    const fixed = await ask(app.gateway, '分错了')
    const route = app.ctx.theone.store.route(fixed.input.id)!.decision
    assert.equal(route.action, 'CREATE')
    assert.equal(route.title, oldRequest)
    assert.equal(route.historyIndependent, true)
    assert.equal(route.correctionOf, first.input.id)
    assert.equal(fixed.output, `answer:${route.contextId}`)
  } finally { await app.close() }
})

test('correction candidates preserve source priority, deduplicate and exclude unavailable topics', { timeout: 30000 }, async () => {
  const app = await fixture({ editing: false, llm: true, history: true })
  try {
    const store = app.ctx.theone.store
    store.seed(['C', 'D', 'E', 'F'].map(id => ({ id, title: id, summary: id, lastState: id, entities: [], keywords: [] })))
    await ask(app.gateway, oldRequest)
    const first = store.recentRoutes('test-gateway', 1)[0]
    store.moveRoute(first.messageId, 'test-gateway', { ...first.decision, alternateIds: ['missing', 'C', B, B, A] })
    store.replaceHidden([{ id: 'C', reason: 'excluded' }])
    store.plan('prior-correction', app.gateway.id, 'test-gateway', { action: 'MOUNT', contextId: A, reason: 'test' }, false)
    store.recordRouteDetail('prior-correction', oldRequest, {})
    store.correctRoute('prior-correction', 'E')
    app.ctx.theone.catalog!.candidates = async () => [store.contexts().find(context => context.id === 'C')!, store.contexts().find(context => context.id === B)!, store.contexts().find(context => context.id === 'D')!]
    app.choose(request => {
      assert.deepEqual(labels(request), ['Video Attention Thesis', 'D', 'E', '新开一个话题'])
      assert.equal(request.questions[0].options![0].description, '当时也考虑过它')
      assert.equal(request.questions[0].options![1].description, undefined)
      assert.equal(request.questions[0].options![2].description, undefined)
      return select('E')
    })
    const fixed = await ask(app.gateway, '分错了')
    assert.equal(fixed.output, 'answer:E')
  } finally { await app.close() }
})

test('recently active topics fill the remaining correction choices in order', { timeout: 30000 }, async () => {
  const app = await fixture({ editing: false, llm: true })
  try {
    const store = app.ctx.theone.store
    store.seed(['C', 'D', 'E'].map(id => ({ id, title: id, summary: id, lastState: id, entities: [], keywords: [] })))
    for (const id of ['C', 'D', 'E']) {
      store.plan(`used-${id}`, app.gateway.id, 'test-gateway', { action: 'MOUNT', contextId: id, reason: 'test' }, false)
      store.finish(`used-${id}`, 'completed')
    }
    store.mount('test-gateway', 'E')
    await ask(app.gateway, '继续')
    await ask(app.gateway, oldRequest)
    // Topic activity may happen directly in a topic session, without a main-chat route.
    const e = app.ctx.agents.get(SessionId(app.workerId('E')))!
    await ask(e, 'ordinary activity')
    const previous = store.recentRoutes('test-gateway', 1)[0]
    store.moveRoute(previous.messageId, 'test-gateway', { ...previous.decision, alternateIds: [] })
    app.choose(request => {
      assert.equal(labels(request)[0], 'E')
      assert.equal(request.questions[0].options![0].description, '最近用过')
      assert.equal(labels(request).length, 4)
      return select('E')
    })
    const fixed = await ask(app.gateway, '分错了')
    assert.equal(fixed.output, 'answer:E')
  } finally { await app.close() }
})

for (const fallback of ['empty', 'error', 'none', 'unknown-other', 'service-missing'] as const) {
  test(`unclear correction ${fallback} retains its fixed clarification`, { timeout: 30000 }, async () => {
    const app = await fixture({ editing: false, llm: true, questions: fallback !== 'service-missing' })
    try {
      await ask(app.gateway, oldRequest)
      if (fallback === 'none') app.ctx.theone.store.deleteTopic(B)
      app.choose(() => {
        if (fallback === 'error') throw new UserQuestionError('synthetic cancellation', 'ASK_ABORTED')
        return fallback === 'unknown-other' ? custom('继续上次那个未知话题') : { answers: [] }
      })
      const fixed = await ask(app.gateway, '分错了')
      assert.equal(fixed.output, '应该放到哪个话题？可以说「分错了，是 某某 的」，我会把上一条交给它重新处理。')
      assert.equal(app.ctx.theone.store.route(fixed.input.id)?.decision.reason, 'correction-unclear')
      assert.equal(app.prompts.length, fallback === 'none' || fallback === 'service-missing' ? 0 : 1)
    } finally { await app.close() }
  })
}

test('correction Other reroutes once using the typed hint', { timeout: 30000 }, async () => {
  const app = await fixture({ editing: false, llm: true })
  try {
    const first = await ask(app.gateway, oldRequest)
    const original = app.model.behavior!
    app.model.behavior = async function* (request) {
      if (request.system?.startsWith(ROUTING_PROMPT) && JSON.stringify(request.messages).includes('it is the thesis')) {
        yield* textResponse(JSON.stringify({ action: 'EXISTING', contextId: B, title: null, question: null, reason: 'typed hint' }))
      } else yield* original(request)
    }
    app.choose(() => custom('it is the thesis'))
    const fixed = await ask(app.gateway, '分错了')
    assert.equal(fixed.output, `answer:${B}`)
    assert.equal(app.ctx.theone.store.route(fixed.input.id)?.decision.correctionOf, first.input.id)
    assert.equal(app.prompts.length, 1)
  } finally { await app.close() }
})

test('English target and correction messages use English prompts and descriptions', { timeout: 30000 }, async () => {
  const app = await fixture()
  try {
    await ask(app.gateway, 'Put the Qwen and thesis progress in notes')
    const question = app.prompts[0].questions[0]
    assert.equal(question.header, 'Which topic')
    assert.equal(question.question, 'This message went to "Qwen / RX 9070 XT", but it may be about "Video Attention Thesis". Where should it be done?')
    assert.deepEqual(question.options!.map(option => option.label), ['Do it in "Qwen / RX 9070 XT"', 'It\'s about "Video Attention Thesis"', 'Start a new topic'])
    assert.equal(question.options![0].description, 'Go ahead; no more asking for this message')
  } finally { await app.close() }
  const correction = await fixture({ editing: false, llm: true })
  try {
    await ask(correction.gateway, 'Continue the previous configuration notes')
    correction.choose(request => select(labels(request).at(-1)!))
    await ask(correction.gateway, 'Wrong topic')
    assert.equal(correction.prompts[0].questions[0].header, 'Wrong topic')
    assert.equal(correction.prompts[0].questions[0].question, 'Which topic should the last message go to?')
    assert.equal(labels(correction.prompts[0]).at(-1), 'Start a new topic')
  } finally { await correction.close() }
})

test('colliding and long option labels stay unique and map to the selected topic', { timeout: 30000 }, async () => {
  const app = await fixture({ editing: false, llm: true })
  try {
    const store = app.ctx.theone.store
    store.seed(['C', 'D'].map(id => ({ id, title: '新开一个话题', summary: id, lastState: id, entities: [], keywords: [] })))
    const first = await ask(app.gateway, oldRequest)
    const route = store.route(first.input.id)!.decision
    store.moveRoute(first.input.id, 'test-gateway', { ...route, alternateIds: ['C', 'D'] })
    app.choose(request => {
      assert.deepEqual(labels(request).slice(0, 2), ['新开一个话题（2）', '新开一个话题（3）'])
      return select('新开一个话题（3）')
    })
    const fixed = await ask(app.gateway, '分错了')
    assert.equal(fixed.output, 'answer:D')
  } finally { await app.close() }
  const long = await fixture()
  try {
    long.ctx.theone.store.seed([{ id: 'C', title: '长'.repeat(60), summary: '文档', lastState: '待做', entities: ['文档'], keywords: [] },
      { id: 'D', title: '长'.repeat(59) + '短', summary: '手册', lastState: '待做', entities: ['手册'], keywords: [] }])
    long.ctx.theone.store.mount('test-gateway', A)
    long.choose(request => {
      const choices = labels(request)
      assert.equal(new Set(choices).size, choices.length)
      assert.ok(choices.every(label => [...label].length <= 40))
      assert.ok(choices.some(label => label.includes('…')))
      return select(choices[2])
    })
    const result = await ask(long.gateway, 'Qwen 文档 手册的笔记整理一下')
    assert.equal(result.output, 'answer:D')
  } finally { await long.close() }
})

test('ordinary answers and confident changes do not introduce route questions', { timeout: 30000 }, async () => {
  const app = await fixture({ editing: false })
  try {
    await ask(app.gateway, requestText)
    assert.equal(app.prompts.length, 0)
    assert.equal(app.approvals.length, 0)
  } finally { await app.close() }
  const editing = await fixture()
  try {
    await ask(editing.gateway, 'Qwen 的笔记整理一下')
    assert.equal(editing.prompts.length, 0)
    assert.equal(editing.approvals.length, 0)
    assert.equal(editing.edits.length, 2)
  } finally { await editing.close() }
})

for (const phase of ['target', 'correction'] as const) {
  test(`cancelling the gateway during a ${phase} question propagates cancellation without approval`, { timeout: 30000 }, async () => {
    const app = await fixture({ editing: phase === 'target', llm: phase === 'correction' })
    const entered = Promise.withResolvers<void>()
    try {
      if (phase === 'correction') await ask(app.gateway, oldRequest)
      app.choose(request => new Promise((_resolve, reject) => {
        entered.resolve()
        request.signal!.addEventListener('abort', () => reject(new UserQuestionError('synthetic abort', 'ASK_ABORTED')), { once: true })
      }))
      const pending = ask(app.gateway, phase === 'target' ? requestText : '分错了')
      await entered.promise
      app.gateway.cancel({ kind: 'user' })
      const cancelled = await pending
      assert.equal(cancelled.end?.data.reason.kind, 'aborted')
      assert.equal(app.approvals.length, 0)
      assert.equal(app.edits.length, 0)
      app.choose(request => select(labels(request)[0]))
      const resumed = await ask(app.gateway, 'Qwen 的笔记整理一下')
      assert.equal(resumed.end?.data.reason.kind, 'completed', 'cancellation releases routing and question state')
    } finally { await app.close() }
  })
}

test('target choices still work when only userQuestions is installed', { timeout: 30000 }, async () => {
  const app = await fixture()
  try {
    app.ctx.set('approval', undefined as never)
    app.choose(request => select(labels(request)[1]))
    const result = await ask(app.gateway, requestText)
    assert.equal(result.output, `answer:${B}`)
    assert.equal(app.prompts.length, 1)
    assert.equal(app.approvals.length, 0)
    assert.deepEqual(app.edits, [app.workerId(B), app.workerId(B)])
  } finally { await app.close() }
})

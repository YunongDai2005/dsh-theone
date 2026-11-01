import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { HistoryCatalog, CATALOG_PROMPT } from '../src/history-catalog.ts'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { ContextStore } from '../src/store.ts'
import { ROUTING_PROMPT } from '../src/llm-router.ts'
import { ownFactsText } from '../src/fact-flow.ts'
import { CARD_PROMPT } from '../src/topic-memory.ts'
import { ask, harness, FixtureModel, peered, textResponse } from './harness.ts'

const A = 'ctx_qwen_9070xt', B = 'ctx_thesis', poison = '错误预算'
const card = { summary: poison, aliases: [poison], entities: [poison], settled: [`${poison}：800`], open: [poison] }
const route = (id: string) => JSON.stringify({ action: 'EXISTING', contextId: id, reason: 'fixture', relatedIds: id === A ? [B] : [] })
const topicOf = (options: Parameters<NonNullable<FixtureModel['behavior']>>[0]) => {
  const message = options.messages.findLast(message => 'source' in message && message.source?.kind === 'theone-context')
  return message && 'source' in message && message.source?.kind === 'theone-context' ? message.source.contextId : undefined
}
async function correction(app: Awaited<ReturnType<typeof harness>>, messageId: string, contextId: string) {
  const handler = peered(new HostConnectionService(app.ctx, [], undefined as never))
  await new Promise<void>(resolve => setImmediate(resolve))
  const result = await handler.fetch(new Request('http://dsh.internal/api/theone/routes', { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messageId, contextId }) }))
  assert.equal(result.status, 200)
  await app.ctx.theone.learning
}

test('correcting a completed route removes its usage prior from the wrong topic', () => {
  const store = new ContextStore(':memory:')
  try {
    store.seed([A, B].map(id => ({ id, title: id, summary: '', entities: [], keywords: [], lastState: '' })))
    store.plan('wrong', 'gateway', 'key', { action: 'MOUNT', contextId: A, reason: 'fixture' })
    store.finish('wrong', 'completed')
    store.correctRoute('wrong', B)
    assert.deepEqual(store.contextUsage('key').map(row => [row.contextId, row.completedCalls]), [[B, 1]])
  } finally { store.close() }
})

test('correction retracts already learned cards, facts, state and links and survives restart', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-learning-'))
  const model = new FixtureModel()
  model.behavior = async function* (options) {
    if (options.system?.startsWith(ROUTING_PROMPT)) { yield* textResponse(route(A)); return }
    if (options.system === CARD_PROMPT) { yield* textResponse(JSON.stringify(card)); return }
    if (options.system?.includes('从用户的更正中学习')) { yield* textResponse(JSON.stringify([poison])); return }
    const last = options.messages.findLastIndex(message => message.role === 'user' && 'source' in message && message.source?.kind === 'user')
    const calls = options.messages.slice(last + 1).filter(message => message.role === 'tool').length
    if (calls < 2) {
      const name = calls ? 'theone_update_state' : 'theone_record'
      const args = calls ? { state: poison, constraints: poison } : { items: [{ label: poison, kind: 'fact', value: '800', evidenceQuote: `${poison}定为 800 元` }] }
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: ToolCallId(`learning-${calls}`), name, arguments: JSON.stringify(args) } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    } else yield* textResponse('已记录')
  }
  let app = await harness(root, model, { routerMode: 'llm', theoneConfig: { topicCards: true, factLinks: true } })
  try {
    const sent = await ask(app.gateway, `Qwen 的${poison}定为 800 元`)
    await app.ctx.theone.extracting
    let store = app.ctx.theone.store
    assert.ok(store.names(A).get(A)?.includes(poison), 'correct routes learn on the first completed turn')
    assert.equal(store.facts(A)[0]?.value, '800')
    assert.ok(store.links(A).some(link => link.weight > 0))
    await correction(app, sent.input.id, B)
    const clean = () => {
      assert.ok(!JSON.stringify(store.contexts().find(topic => topic.id === A)).includes(poison), 'descriptor must be rebuilt')
      assert.ok(!store.names(A).get(A)?.includes(poison), 'aliases must be retracted')
      assert.equal(store.settled(A).length, 0)
      assert.equal(store.openItems(A).length, 0)
      assert.equal(store.facts(A).length, 0)
      assert.ok(!ownFactsText(store, A).includes(poison), 'withdrawn labels do not re-enter the Worker descriptor')
      assert.equal(store.constraints(A), undefined)
      assert.equal(store.stateUpdates(A).length, 0)
      assert.ok(store.links(A).every(link => link.weight === 0))
      assert.ok(!store.contextUsage('test-gateway').some(row => row.contextId === A))
    }
    clean()
    await app.close()
    app = await harness(root, model, { routerMode: 'llm', theoneConfig: { topicCards: true, factLinks: true } })
    store = app.ctx.theone.store
    await app.ctx.theone.extracting
    clean()
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('handback starts the replacement only after the first worker is idle', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-learning-handoff-'))
  const model = new FixtureModel()
  let app: Awaited<ReturnType<typeof harness>>
  let overlapping = 0
  const edits: string[] = []
  model.behavior = async function* (options) {
    if (options.system?.startsWith(ROUTING_PROMPT)) {
      const payload = JSON.parse(options.messages[0].content.filter(block => block.type === 'text').map(block => block.text).join(''))
      yield* textResponse(route(payload.contexts.some((topic: { id: string }) => topic.id === A) ? A : B)); return
    }
    if (options.system?.includes('从用户的更正中学习')) { yield* textResponse('[]'); return }
    if (topicOf(options) === B) {
      const session = app.ctx.theone.store.contexts().find(topic => topic.id === A)!.workingSessionId
      if (app.ctx.agents.get(session as never)?.status !== 'idle') overlapping++
      if (!options.messages.some(message => message.role === 'tool')) {
        yield { type: 'block-start', index: 0, blockType: 'tool-call' }
        yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: ToolCallId('right-edit'), name: 'edit', arguments: '{}' } }
        yield { type: 'finish', reason: { kind: 'tool-calls' } }
      } else yield* textResponse('论文回答')
      return
    }
    if (!options.messages.some(message => message.role === 'tool')) {
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: ToolCallId('handoff'), name: 'theone_handback', arguments: '{"reason":"论文"}' } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    } else if (options.messages.filter(message => message.role === 'tool').length === 1) {
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: ToolCallId('wrong-edit'), name: 'edit', arguments: '{}' } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    } else yield* textResponse('停止')
  }
  app = await harness(root, model, { routerMode: 'llm' })
  app.ctx.tools.register(defineTool({ name: 'edit', description: 'Fixture write', parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value: string) => [{ type: 'text', text: value }] },
    execute: async (_args, exec) => { edits.push(exec.agent!.id); return 'written' } }))
  try {
    const result = await ask(app.gateway, '消融表格排版')
    assert.equal(result.output, '论文回答')
    assert.equal(overlapping, 0)
    const right = app.ctx.theone.store.contexts().find(topic => topic.id === B)!.workingSessionId
    assert.deepEqual(edits, [right], 'zero wrong-project writes; one actual execution')
    app.gateway.followup(result.input)
    await app.gateway.whenIdle()
    assert.deepEqual(edits, [right], 'a duplicate input never executes twice')
    assert.ok(app.ctx.theone.store.misrouteEffects(result.input.id).every(record => record.changes.length === 0), 'denied calls are not reported as external work')
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('rebuilding projections keeps independent later learning and explicit edits', () => {
  const store = new ContextStore(':memory:')
  try {
    store.seed([A, B].map(id => ({ id, title: id, summary: 'base', entities: [], keywords: [], lastState: '' })))
    for (const id of ['bad', 'good']) store.plan(id, 'g', 'k', { action: 'MOUNT', contextId: A, reason: 'fixture' })
    store.finish('bad', 'completed'); store.finish('good', 'completed')
    const bad = store.learningJournal.source('bad', A), good = store.learningJournal.source('good', A)
    store.withLearning([bad], () => {
      store.applyCard(A, card)
      store.addKeywords(A, [poison])
      store.learnTerms(A, [poison], 5)
      store.learnLink(A, B, 5)
    })
    store.withLearning([good], () => {
      store.applyCard(A, { summary: 'clean', entities: ['clean'], aliases: ['clean'], settled: ['clean: 12'], open: ['clean'] })
      store.learnTerms(A, ['clean'], 1)
      store.learnLink(A, B, 0.4)
    })
    store.editTopic(A, { summary: 'user summary' })
    store.correctRoute('bad', B)
    assert.equal(store.contexts().find(topic => topic.id === A)!.summary, 'user summary')
    assert.deepEqual(store.contexts().find(topic => topic.id === A)!.keywords, [])
    assert.deepEqual(store.names(A).get(A), ['clean'])
    assert.deepEqual(store.learnedTerms().get(A), ['clean'])
    assert.ok(store.links(A)[0].weight > 0.39 && store.links(A)[0].weight <= 0.4)
    assert.ok(store.learningJournal.audit().filter(event => event.active && event.sources.length).every(event => event.sources[0].messageId === 'good'))
  } finally { store.close() }
})

test('a card already in flight cannot commit after correction', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-learning-race-'))
  const started = Promise.withResolvers<void>(), release = Promise.withResolvers<void>()
  const model = new FixtureModel()
  model.behavior = async function* (options) {
    if (options.system?.startsWith(ROUTING_PROMPT)) { yield* textResponse(route(A)); return }
    if (options.system === CARD_PROMPT) { started.resolve(); await release.promise; yield* textResponse(JSON.stringify(card)); return }
    if (options.system?.includes('从用户的更正中学习')) { yield* textResponse('[]'); return }
    yield* textResponse('done')
  }
  const app = await harness(root, model, { routerMode: 'llm', theoneConfig: { topicCards: true } })
  try {
    const sent = await ask(app.gateway, `Qwen ${poison}`)
    await started.promise
    await correction(app, sent.input.id, B)
    release.resolve()
    await app.ctx.theone.extracting
    await app.ctx.theone.extracting
    assert.equal(app.ctx.theone.store.names(A).get(A), undefined)
    assert.ok(!app.ctx.theone.store.contexts().find(topic => topic.id === A)!.summary.includes(poison))
  } finally { release.resolve(); await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('a checkpoint from an excluded turn is not restored after restart', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-learning-checkpoint-'))
  let app = await harness(root)
  try {
    const sent = await ask(app.gateway, `Qwen ${poison}`)
    const topic = app.ctx.theone.store.contexts().find(topic => topic.id === A)!
    const worker = app.ctx.agents.get(topic.workingSessionId as never)!
    const job = app.ctx.theone.work.store.enqueue({ key: 'stale-card', kind: 'card', resource: `memory:${A}`,
      payload: { contextId: A, sessionId: worker.id, throughSeq: worker.session.snapshotEvents().at(-1)!.seq, base: [] } })
    const claimed = app.ctx.theone.work.store.claim()!
    app.ctx.theone.work.store.checkpoint(claimed, card)
    app.ctx.theone.work.store.release(claimed)
    await correction(app, sent.input.id, B)
    await app.close()
    app = await harness(root, undefined, { theoneConfig: { topicCards: true } })
    await app.ctx.theone.extracting
    assert.equal(app.ctx.theone.work.store.get(job.id)!.state, 'completed')
    assert.equal(app.ctx.theone.store.names(A).get(A), undefined)
    assert.equal(app.model.requests.length, 0, 'no valid evidence needs no regeneration call')
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('facts from an uncertain owner stay proposed until positive target evidence', () => {
  const store = new ContextStore(':memory:')
  try {
    store.seed([A, B].map(id => ({ id, title: id, summary: '', entities: [], keywords: [], lastState: '' })))
    store.plan('uncertain', 'g', 'k', { action: 'MOUNT', contextId: A, alternateIds: [B], reason: 'unclear-settled' })
    const source = store.learningJournal.source('uncertain', A)
    store.withLearning([source], () => store.recordFact(A, { label: 'budget', kind: 'fact', value: '800', status: 'confirmed',
      evidence: { sessionId: 's', seq: 1, speaker: 'user', quote: 'budget 800' }, origin: 'worker' }))
    assert.equal(store.sharedFacts().length, 0, 'user evidence of the value is not evidence of its topic')
    store.finish('uncertain', 'completed')
    assert.equal(store.sharedFacts().length, 0, 'successful execution does not resolve an ambiguous owner')
    store.confirmLearning('uncertain', A)
    assert.equal(store.sharedFacts()[0].value, '800')
  } finally { store.close() }
})

test('merge and unmerge cannot preserve invalid route-derived metadata', () => {
  const store = new ContextStore(':memory:')
  try {
    store.seed([A, B, 'third'].map(id => ({ id, title: id, summary: 'base', entities: [], keywords: [], lastState: '' })))
    store.plan('bad', 'g', 'k', { action: 'MOUNT', contextId: A, reason: 'fixture' })
    const source = store.learningJournal.source('bad', A)
    store.withLearning([source], () => store.applyCard(A, card))
    store.mergeTopics(A, B)
    store.correctRoute('bad', 'third')
    assert.ok(!JSON.stringify(store.contexts().find(topic => topic.id === B)).includes(poison))
    assert.ok(!store.names(B).get(B)?.includes(poison))
    store.unmergeTopic(A)
    assert.ok(!JSON.stringify(store.contexts().find(topic => topic.id === A)).includes(poison), 'unmerge cannot resurrect revoked memory')
    assert.ok(!store.names(A).get(A)?.includes(poison))
  } finally { store.close() }
})

test('invalid fact versions restore the last valid value and notify dependent topics', () => {
  const store = new ContextStore(':memory:')
  try {
    store.seed([A, B].map(id => ({ id, title: id, summary: '', entities: [], keywords: [], lastState: '' })))
    store.plan('good', 'g', 'k', { action: 'MOUNT', contextId: A, reason: 'fixture' })
    store.plan('bad', 'g', 'k', { action: 'MOUNT', contextId: A, reason: 'fixture' })
    const write = (id: string, value: string, seq: number, aliases: string[]) => store.withLearning([store.learningJournal.source(id, A)], () =>
      store.recordFact(A, { label: 'budget', value, aliases, kind: 'fact', status: 'confirmed', origin: 'worker',
        evidence: { sessionId: 'session', seq, speaker: 'user', quote: `budget ${value}` } })).fact!
    write('good', '700', 1, ['valid'])
    const bad = write('bad', '800', 2, [poison])
    store.recordDelivery(B, bad, 'route')
    store.correctRoute('bad', B)
    const current = store.fact(bad.id)!
    assert.equal(current.value, '700')
    assert.ok(current.version > bad.version, 'withdrawal must advance versions for downstream readers')
    assert.deepEqual(current.aliases, ['valid'])
    assert.equal(store.dependencies(B)[0].versionSeen, bad.version)
  } finally { store.close() }
})

test('a resumed worker never receives the excluded turn as reusable conversation', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-learning-surface-'))
  let app = await harness(root)
  try {
    const sent = await ask(app.gateway, `Qwen ${poison}`)
    await correction(app, sent.input.id, B)
    await app.close()
    app = await harness(root)
    const result = await ask(app.gateway, 'Qwen 推理性能')
    assert.equal(result.end?.data.reason.kind, 'completed', JSON.stringify(result.events))
    const request = app.model.requests.at(-1)!
    assert.ok(!JSON.stringify(request.messages).includes(poison), 'the real restored model surface must omit rejected evidence')
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('a catalog refresh cannot re-extract excluded turns or keep their keywords', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-learning-catalog-'))
  const model = new FixtureModel()
  const inputs: string[] = []
  model.behavior = async function* (options) {
    if (options.system === CATALOG_PROMPT) {
      const payload = JSON.parse(options.messages[0].content.filter(block => block.type === 'text').map(block => block.text).join(''))
      if (payload.ownedContextId === A) inputs.push(JSON.stringify(payload.turns))
      const dirty = JSON.stringify(payload.turns).includes(poison)
      yield* textResponse(JSON.stringify({ topics: [{ contextId: payload.ownedContextId, title: 'Qwen', summary: dirty ? poison : 'clean summary',
        entities: [], keywords: [dirty ? poison : 'clean-keyword'], lastState: 'in progress', turns: payload.turns.map((turn: { seq: number }) => turn.seq),
        groupId: null, groupTitle: 'fixture', groupSummary: 'fixture' }] }))
    } else yield* textResponse('done')
  }
  const app = await harness(root, model)
  const store = app.ctx.theone.store
  const catalog = new HistoryCatalog(app.ctx, store, () => ({ provider: 'fixture', model: 'fixture' }))
  try {
    const sent = await ask(app.gateway, `Qwen ${poison}`)
    await catalog.refresh()
    assert.ok(store.contexts().find(topic => topic.id === A)!.keywords.includes(poison))
    await correction(app, sent.input.id, B)
    assert.ok(!store.contexts().find(topic => topic.id === A)!.keywords.includes(poison))
    inputs.length = 0
    await ask(app.gateway, 'Qwen clean settings')
    await catalog.refresh()
    assert.ok(inputs.length)
    assert.ok(inputs.every(input => !input.includes(poison)))
    assert.deepEqual(store.contexts().find(topic => topic.id === A)!.keywords, ['clean-keyword'])
  } finally { await catalog.close(); await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('a branch retains source provenance when its copied descriptor is later revoked', () => {
  const store = new ContextStore(':memory:')
  try {
    store.seed([A, B].map(id => ({ id, title: id, summary: 'base', entities: [], keywords: [], lastState: '' })))
    store.plan('bad', 'g', 'k', { action: 'MOUNT', contextId: A, reason: 'fixture' })
    store.withLearning([store.learningJournal.source('bad', A)], () => store.applyCard(A, card))
    const branch = store.branchTopic(A, 'branch', 'branch-session')
    assert.ok(store.contexts().find(topic => topic.id === branch)!.entities.includes(poison))
    store.correctRoute('bad', B)
    assert.ok(!JSON.stringify(store.contexts().find(topic => topic.id === branch)).includes(poison))
  } finally { store.close() }
})

test('a route proposal cannot train relatedness; completion commits it once without another message', () => {
  const store = new ContextStore(':memory:')
  try {
    store.seed([A, B].map(id => ({ id, title: id, summary: '', entities: [], keywords: [], lastState: '' })))
    store.plan('proposal', 'g', 'k', { action: 'MOUNT', contextId: A, reason: 'fixture' })
    const source = store.learningJournal.source('proposal', A)
    store.withLearning([source], () => store.learnLink(A, B, 0.5))
    assert.deepEqual(store.links(A), [])
    store.finish('proposal', 'completed')
    store.finish('proposal', 'completed')
    assert.ok(store.links(A)[0].weight > 0.49 && store.links(A)[0].weight <= 0.5)
    assert.equal(store.learningJournal.stage(source), 'inferred', 'completion is not user confirmation')
  } finally { store.close() }
})

test('a corrected CREATE retracts its inferred title, keywords and workspace membership', () => {
  const store = new ContextStore(':memory:')
  try {
    store.seed([{ id: B, title: B, summary: '', entities: [], keywords: [], lastState: '' }])
    store.moveTopic(B, { title: 'Existing workspace' })
    const created = store.plan('new-bad', 'g', 'k', { action: 'CREATE', title: poison, relatedIds: [B], reason: 'fixture' }).decision.contextId!
    assert.ok(store.groups().some(group => group.contextIds.includes(created)))
    store.correctRoute('new-bad', B)
    assert.ok(!JSON.stringify(store.contexts().find(topic => topic.id === created)).includes(poison))
    assert.ok(!store.groups().some(group => group.contextIds.includes(created)))
    const manual = store.plan('new-manual', 'g', 'k', { action: 'CREATE', title: poison, relatedIds: [B], reason: 'fixture' }).decision.contextId!
    store.editTopic(manual, { title: 'User title' })
    store.moveTopic(manual, { title: 'User workspace' })
    store.correctRoute('new-manual', B)
    assert.equal(store.contexts().find(topic => topic.id === manual)!.title, 'User title')
    assert.ok(store.groups().some(group => group.title === 'User workspace' && group.contextIds.includes(manual)))
  } finally { store.close() }
})

test('a valid later fact value does not preserve aliases inherited from a wrong route', () => {
  const store = new ContextStore(':memory:')
  try {
    store.seed([A, B].map(id => ({ id, title: id, summary: '', entities: [], keywords: [], lastState: '' })))
    const write = (id: string, value: string, seq: number, aliases: string[]) => {
      store.plan(id, 'g', 'k', { action: 'MOUNT', contextId: A, reason: 'fixture' })
      return store.withLearning([store.learningJournal.source(id, A)], () => store.recordFact(A, {
        label: 'budget', value, aliases, kind: 'fact', status: 'confirmed', origin: 'worker',
        evidence: { sessionId: 'session', seq, speaker: 'user', quote: `budget ${value}` } })).fact!
    }
    write('bad', '800', 1, [poison])
    const good = write('good', '900', 2, ['clean'])
    store.correctRoute('bad', B)
    const current = store.fact(good.id)!
    assert.equal(current.value, '900')
    assert.deepEqual(current.aliases, ['clean'])
    assert.ok(current.version > good.version)
  } finally { store.close() }
})


test('a link-only contribution is revoked through merge and unmerge', () => {
  const store = new ContextStore(':memory:')
  try {
    store.seed([A, B, 'other', 'right'].map(id => ({ id, title: id, summary: '', entities: [], keywords: [], lastState: '' })))
    store.plan('bad-link', 'g', 'k', { action: 'MOUNT', contextId: A, reason: 'fixture' })
    store.finish('bad-link', 'completed')
    store.withLearning([store.learningJournal.source('bad-link', A)], () => store.learnLink(A, 'other', 0.8))
    store.mergeTopics(A, B)
    assert.ok(store.links(B).some(link => link.weight > 0.7))
    store.correctRoute('bad-link', 'right')
    assert.ok(store.links(B).every(link => link.weight === 0))
    store.unmergeTopic(A)
    assert.ok(store.links(A).every(link => link.weight === 0))
    assert.ok(store.links(B).every(link => link.weight === 0))
  } finally { store.close() }
})

test('a later topic cannot retain memory copied from an excluded route through its briefing', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-learning-derived-'))
  const model = new FixtureModel()
  let routes = 0
  model.behavior = async function* (options) {
    if (options.system?.startsWith(ROUTING_PROMPT)) {
      yield* textResponse(JSON.stringify({ action: 'EXISTING', contextId: routes++ ? B : A, relatedIds: [A], reason: 'fixture' })); return
    }
    if (options.system === CARD_PROMPT) { yield* textResponse(JSON.stringify(card)); return }
    if (options.system?.includes('从用户的更正中学习')) { yield* textResponse('[]'); return }
    if (topicOf(options) === B && !options.messages.some(message => message.role === 'tool')) {
      assert.ok(JSON.stringify(options.messages).includes(poison), 'the receiving Worker actually saw the bad reference')
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: ToolCallId('copied-state'), name: 'theone_update_state', arguments: JSON.stringify({ state: poison }) } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    } else yield* textResponse('done')
  }
  const app = await harness(root, model, { routerMode: 'llm', theoneConfig: { topicCards: true } })
  try {
    const bad = await ask(app.gateway, `Qwen ${poison}`)
    await app.ctx.theone.extracting
    await ask(app.gateway, '论文需要参考 Qwen 那边的结论')
    assert.ok(app.ctx.theone.store.stateUpdates(B).some(item => String(item.state).includes(poison)))
    await correction(app, bad.input.id, B)
    assert.ok(!app.ctx.theone.store.stateUpdates(B).some(item => String(item.state).includes(poison)))
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

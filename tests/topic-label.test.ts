import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DshRouter, ROUTING_PROMPT, routingPayload, validateRoutingDecision } from '../src/llm-router.ts'
import { ContextStore } from '../src/store.ts'
import { projectBubbles } from '../src/bubble-projection.ts'
import { ask, FixtureModel, harness, textResponse } from './harness.ts'

const scope = { gatewayKey: 'test-gateway', gatewayId: 'main' }
const input = { text: '规划日本旅行路线', contexts: [] }
const create = { action: 'CREATE', title: '日本旅行', reason: '新事项', historyIndependent: true }
const topic = { id: 'topic', title: '日本旅行', summary: '', entities: ['日本', '东京'], keywords: ['旅行'], lastState: '', label: '日本游' }
const labelOf = (store: ContextStore, id = 'topic') => projectBubbles(store, { scope }).topics.find(row => row.id === id)?.label

for (const row of [
  { label: '日本游', want: '日本游' },
  { label: '旅行', want: '旅行' },
  { label: '日本行程', want: '日本行程' },
  { label: 'Travel', want: 'Travel' },
  { label: ' Japan   travel ', want: 'Japan travel' },
  { label: '日本旅行规划', want: undefined },
  { label: '日', want: undefined },
  { label: '日本，旅行', want: undefined },
  { label: '旅行！', want: undefined },
  { label: 'Japan-trip', want: undefined },
  { label: 'Japan travel planning', want: undefined },
  { label: 'InternationalizationPlans', want: undefined },
  { label: 'Japan\ntravel', want: undefined },
  { label: '🙂', want: undefined },
  { label: '', want: undefined },
  { label: '   ', want: undefined },
  { label: null, want: undefined },
  { label: 42, want: undefined },
  { label: undefined, want: undefined },
]) test(`classifier label is optional and bounded: ${JSON.stringify(row.label)}`, async () => {
  let calls = 0
  const llm = {
    resolveModelInfo: async () => ({ provider: 'fixture', id: 'fixture', name: 'fixture' }),
    prepareCall: async () => ({ config: { provider: 'fixture', model: 'fixture' }, stream: function* () {
      calls++
      yield* textResponse(JSON.stringify({ ...create, label: row.label }))
    } }),
  }
  const store = new ContextStore(':memory:')
  try {
    const { decision, attempts } = await new DshRouter(llm as never, () => ({ provider: 'fixture', model: 'fixture' })).decide(input)
    assert.equal(decision.action, 'CREATE')
    assert.equal(decision.label, row.want)
    const route = store.plan('message', 'main', scope.gatewayKey, decision)
    assert.equal(store.contexts()[0].label, row.want)
    assert.equal(labelOf(store, route.decision.contextId), row.want ?? '日本旅行')
    assert.equal(calls, 1, 'a missing or invalid label must not trigger a retry or a labeling call')
    assert.equal(attempts?.length, 1)
  } finally { store.close() }
})

test('projection prefers a stored label and ignores malformed persisted labels without writing', () => {
  const store = new ContextStore(':memory:')
  try {
    store.seed([topic, { ...topic, id: 'invalid', label: '日本旅行规划' }])
    const db = (store as any).db
    const before = db.prepare('SELECT total_changes() AS n').get()
    assert.equal(labelOf(store), '日本游')
    assert.equal(labelOf(store, 'invalid'), '日本')
    assert.deepEqual(db.prepare('SELECT total_changes() AS n').get(), before)
    assert.ok(!JSON.stringify(routingPayload({ ...input, contexts: store.contexts() })).includes('日本游'), 'display labels do not enter routing inputs')
  } finally { store.close() }
})

test('labels survive reopening, progress updates and catalog re-extraction', async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-label-store-'))
  const path = join(root, 'contexts.db')
  let store = new ContextStore(path)
  try {
    const route = store.plan('new-topic', 'main', scope.gatewayKey, { action: 'CREATE', title: '日本旅行', label: '日本游', reason: 'fixture' })
    const id = route.decision.contextId!
    const worker = store.contexts()[0].workingSessionId
    store.updateState(id, '规划路线', worker, 1)
    store.updateSummary(id, '已有行程', worker, 2, 3)
    store.importTopics('source', undefined, [{ seq: 0, endSeq: 2, text: '', fingerprint: 'first' }],
      [{ contextId: id, title: '新的目录标题', summary: '目录摘要', entities: ['日本'], keywords: ['旅行'], lastState: '',
        turns: [0], groupId: null, groupTitle: '旅行', groupSummary: '' }])
    store.close()
    store = new ContextStore(path)
    assert.equal(store.contexts()[0].title, '日本旅行')
    assert.equal(store.contexts()[0].label, '日本游')
    assert.equal(labelOf(store, id), '日本游')
  } finally { store.close(); await rm(root, { recursive: true, force: true }) }
})

test('renaming clears the label, while editing other fields or submitting the same title keeps it', () => {
  const store = new ContextStore(':memory:')
  try {
    store.seed([topic])
    store.editTopic('topic', { title: '日本旅行', summary: '整理行程' })
    assert.equal(labelOf(store), '日本游')
    store.editTopic('topic', { title: '东京路线' })
    assert.equal(store.contexts()[0].label, undefined)
    assert.equal(labelOf(store), '东京')
  } finally { store.close() }
})

test('a branch with its own title does not inherit the source label', () => {
  const store = new ContextStore(':memory:')
  try {
    store.seed([topic])
    const id = store.branchTopic('topic', '东京路线', 'branch-worker')
    assert.equal(labelOf(store, id), '东京')
    assert.equal(labelOf(store), '日本游')
  } finally { store.close() }
})

test('merging keeps the target label and unmerging restores the source label', () => {
  const store = new ContextStore(':memory:')
  try {
    store.seed([topic, { ...topic, id: 'target', title: '东京路线', label: '东京游' }])
    store.mergeTopics('topic', 'target')
    assert.equal(labelOf(store, 'target'), '东京游')
    assert.equal(labelOf(store), undefined)
    store.unmergeTopic('topic')
    assert.equal(labelOf(store), '日本游')
    assert.equal(labelOf(store, 'target'), '东京游')
  } finally { store.close() }
})

test('a duplicate CREATE cannot overwrite an existing topic label', () => {
  const decision = validateRoutingDecision({ ...create, label: '新短名' }, { ...input, contexts: [topic] })
  assert.equal(decision.action, 'MOUNT')
  assert.equal(decision.label, undefined)
  const store = new ContextStore(':memory:')
  try {
    store.seed([topic])
    store.plan('existing', 'main', scope.gatewayKey, decision)
    assert.equal(labelOf(store), '日本游')
  } finally { store.close() }
})

for (const variant of ['none', 'compact'] as const) {
  for (const returned of ['日本游', '日本旅行规划', undefined]) test(`${variant} gateway uses the existing classification and recheck calls: ${returned}`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'theone-label-gateway-'))
    const model = new FixtureModel()
    let classifications = 0
    model.behavior = async function* (options) {
      if (options.system?.startsWith(ROUTING_PROMPT.split('\n')[0])) {
        classifications++
        yield* textResponse(JSON.stringify({ ...create, label: classifications === 1 ? '出行' : returned }))
      } else yield* textResponse('行程已整理')
    }
    const app = await harness(root, model, { routerMode: 'llm', theoneConfig: { routingVariant: variant } })
    try {
      const result = await ask(app.gateway, '帮我规划日本旅行路线')
      const store = app.ctx.theone.store, route = store.route(result.input.id)!
      assert.equal(result.end?.data.reason.kind, 'completed')
      assert.equal(route.decision.action, 'CREATE')
      assert.equal(labelOf(store, route.decision.contextId), returned === '日本游' ? '日本游' : '日本旅行')
      assert.equal(classifications, 2, 'only the existing quick and recheck calls')
      assert.equal(model.requests.length, 3, 'two classifier calls and one Worker call')
      assert.equal(store.routeReceipt(result.input.id)?.calls, 2)
    } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
  })
}

for (const mode of ['rules', 'failure'] as const) test(`${mode} keeps the original rule label and call count`, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-label-fallback-'))
  const model = new FixtureModel()
  let classifications = 0
  model.behavior = async function* (options) {
    if (options.system?.startsWith(ROUTING_PROMPT)) {
      classifications++
      yield { type: 'finish', reason: { kind: 'error', failure: { code: 'FIXTURE_FAILURE', message: 'unavailable', status: 401 } } }
    } else yield* textResponse('行程已整理')
  }
  const app = await harness(root, model, { routerMode: mode === 'rules' ? 'rules' : 'llm' })
  try {
    const result = await ask(app.gateway, '新话题：日本旅行')
    const store = app.ctx.theone.store, route = store.route(result.input.id)!
    assert.equal(result.end?.data.reason.kind, 'completed')
    assert.equal(route.decision.action, 'CREATE')
    assert.equal(store.contexts().find(row => row.id === route.decision.contextId)?.label, undefined)
    assert.equal(labelOf(store, route.decision.contextId), '日本旅行')
    assert.equal(classifications, mode === 'rules' ? 0 : 1)
    assert.equal(model.requests.length, mode === 'rules' ? 1 : 2)
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('a spoken correction creates a topic with the classifier label', async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-label-correction-'))
  const model = new FixtureModel()
  let classifications = 0
  model.behavior = async function* (options) {
    if (options.system?.startsWith(ROUTING_PROMPT)) {
      classifications++
      yield* textResponse(JSON.stringify(classifications === 1
        ? { action: 'EXISTING', contextId: 'ctx_qwen_9070xt', reason: 'fixture' }
        : { ...create, label: '日本游' }))
    } else if (options.system?.includes('从用户的更正中学习')) yield* textResponse('[]')
    else yield* textResponse('行程已整理')
  }
  const app = await harness(root, model, { routerMode: 'llm' })
  try {
    const first = await ask(app.gateway, input.text)
    const fixed = await ask(app.gateway, '分错了')
    const store = app.ctx.theone.store, route = store.route(fixed.input.id)!
    assert.equal(fixed.end?.data.reason.kind, 'completed')
    assert.equal(route.decision.action, 'CREATE')
    assert.equal(route.decision.correctionOf, first.input.id)
    assert.equal(labelOf(store, route.decision.contextId), '日本游')
    assert.equal(classifications, 2, 'one original classification and one correction classification')
    assert.equal(store.routeReceipt(fixed.input.id)?.calls, 1)
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

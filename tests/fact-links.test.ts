import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ToolCallId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { ROUTING_PROMPT, FACTS_PROMPT } from '../src/llm-router.ts'
import { FixtureModel, harness, ask, textResponse } from './harness.ts'

const QWEN = 'ctx_qwen_9070xt', THESIS = 'ctx_thesis'
let calls = 0
function* toolCall(name: string, args: object): Generator<StreamChunk> {
  const id = ToolCallId(`fact-call-${++calls}`)
  yield { type: 'block-start', index: 0, blockType: 'tool-call' }
  yield { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: JSON.stringify(args) }
  yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: JSON.stringify(args) } }
  yield { type: 'finish', reason: { kind: 'tool-calls' } }
}
const text = (message: GenerateOptions['messages'][number] | undefined) => JSON.stringify(message ?? '')
/** The cross-topic reference given with this run: after the run's own descriptor, not earlier runs'. */
const briefing = (request: GenerateOptions | undefined) => {
  const messages = request?.messages ?? []
  const start = messages.findLastIndex(m => 'source' in m && m.source?.kind === 'theone-context')
  return messages.slice(start + 1).filter(m => 'source' in m && m.source?.kind === 'theone-links')
    .flatMap(m => m.content.flatMap(b => b.type === 'text' ? [b.text] : [])).join('\n')
}
const toolResult = (request: GenerateOptions | undefined) => text(request?.messages.at(-1))
/** The parsed output of the tool call the request answers. */
const toolOutput = (request: GenerateOptions | undefined) => {
  const message = request?.messages.at(-1) as { content?: { type: string; text?: string }[] } | undefined
  return JSON.parse(message?.content?.find(block => block.type === 'text')?.text ?? 'null')
}

/**
 * A scripted world: routing follows names in the message (and imports any offered fact when the
 * message mentions the budget); Workers run the queued steps, then answer plainly.
 */
function world() {
  const model = new FixtureModel()
  const payloads: { text: string; currentId: string | null; symbols?: { id: string; label: string; value: string }[] }[] = []
  const steps: ((options: GenerateOptions) => AsyncIterable<StreamChunk>)[] = []
  model.behavior = async function* (options) {
    if (options.system?.startsWith(ROUTING_PROMPT)) {
      const payload = JSON.parse((options.messages[0] as unknown as { content: { text: string }[] }).content[0].text)
      payloads.push(payload)
      assert.equal(options.system.includes(FACTS_PROMPT), !!payload.symbols?.length, 'the fact instructions come only with facts')
      const contextId = /qwen/i.test(payload.text) ? QWEN : /论文/.test(payload.text) ? THESIS : payload.currentId ?? QWEN
      const imports = /预算|budget/i.test(payload.text) ? (payload.symbols ?? []).map((s: { id: string }) => s.id) : []
      yield* textResponse(JSON.stringify({ action: 'EXISTING', contextId, title: null, question: null, reason: 'named', historyIndependent: null, candidateIds: [], relatedIds: [], imports }))
      return
    }
    const step = steps.shift()
    if (step) { yield* step(options); return }
    yield* textResponse('好')
  }
  return { model, payloads, steps }
}

const record = (items: object[]) => async function* () { yield* toolCall('theone_record', { items }) }
const say = (reply: string) => async function* () { yield* textResponse(reply) }

test('confirmed facts reach other topics with evidence; proposals stay home; changes, withdrawals and lost permission are told, also on "go on"', { timeout: 60000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-facts-'))
  const { model, payloads, steps } = world()
  const app = await harness(root, model, { routerMode: 'llm', theoneConfig: { factLinks: true } })
  try {
    const store = app.ctx.theone.store
    // 1. The user states the budget; the Worker records it with the user's words: confirmed.
    steps.push(record([{ label: '预算', kind: 'fact', value: '800', evidenceQuote: '预算定为 800 元' }]), say('记下了'))
    await ask(app.gateway, 'Qwen 这边预算定为 800 元')
    const [budget] = store.facts(QWEN)
    assert.deepEqual([budget.label, budget.value, budget.status, budget.evidence.speaker], ['预算', '800', 'confirmed', 'user'])

    // 2. The Worker's own suggestion is only a proposal until the user accepts it.
    steps.push(say('建议显存预留 24G'))
    await ask(app.gateway, 'Qwen 显存要留多少')
    steps.push(record([{ label: '显存', kind: 'decision', value: '24G', evidenceQuote: '建议显存预留 24G' }]), say('先记为建议'))
    await ask(app.gateway, 'Qwen 你先记一下')
    const vram = store.facts(QWEN).find(fact => fact.label === '显存')!
    assert.equal(vram.status, 'proposed')
    assert.match(toolResult(model.requests.at(-1)), /kept as a proposal/)
    assert.ok(!store.sharedFacts().some(fact => fact.id === vram.id))
    // From its next run on, the Worker sees its topic's facts, the proposal marked as such.
    await ask(app.gateway, 'Qwen 好的')
    assert.match(text(model.requests.at(-1)?.messages.findLast(m => 'source' in m && m.source?.kind === 'theone-context')), /显存 = 24G（建议，用户未确认）/)

    // 3. Another topic asks about the budget: the router is offered the confirmed fact only, imports it,
    //    and the thesis Worker receives exactly that line.
    await ask(app.gateway, '论文里写一下预算')
    const offered = payloads.at(-1)!.symbols ?? []
    assert.deepEqual(offered.map(symbol => symbol.id), [budget.id])
    assert.match(briefing(model.requests.at(-1)), /【Qwen \/ RX 9070 XT】预算 = 800（第 1 版，用户确认于 /)
    assert.deepEqual(store.dependencies(THESIS), [{ factId: budget.id, versionSeen: 1 }])

    // 4. The budget changes elsewhere; the thesis hears it on a bare "go on" (fast path, no routing call).
    const routed = payloads.length
    store.recordFact(QWEN, { factId: budget.id, label: '预算', kind: 'fact', value: '700', status: 'confirmed', evidence: { sessionId: 'elsewhere', seq: 1, speaker: 'user', quote: '改成 700' }, origin: 'worker' })
    await ask(app.gateway, '继续')
    assert.equal(payloads.length, routed, '"继续" stays put without a routing call')
    assert.match(briefing(model.requests.at(-1)), /预算：800 → 700（第 2 版）/)
    await ask(app.gateway, '继续')
    assert.doesNotMatch(briefing(model.requests.at(-1)), /预算/, 'a change is told once')

    // 5. Withdrawn, then confirmed again.
    store.retractFact(QWEN, budget.id, { sessionId: 'elsewhere', seq: 2, speaker: 'user', quote: '预算还没定' }, 'worker')
    await ask(app.gateway, '继续')
    assert.match(briefing(model.requests.at(-1)), /预算：已撤回或目前没有确认的值/)
    store.recordFact(QWEN, { factId: budget.id, label: '预算', kind: 'fact', value: '650', status: 'confirmed', evidence: { sessionId: 'elsewhere', seq: 3, speaker: 'user', quote: '定 650' }, origin: 'worker' })
    await ask(app.gateway, '继续')
    assert.match(briefing(model.requests.at(-1)), /预算：重新确认为 650/)

    // 6. The source stops sharing: only the name is told, never the value, and the dependency is dropped.
    store.setPrivate(QWEN, true)
    store.recordFact(QWEN, { factId: budget.id, label: '预算', kind: 'fact', value: '600', status: 'confirmed', evidence: { sessionId: 'elsewhere', seq: 4, speaker: 'user', quote: '定 600' }, origin: 'worker' })
    await ask(app.gateway, '继续')
    assert.match(briefing(model.requests.at(-1)), /之前引用的「预算」不再可用/)
    assert.doesNotMatch(briefing(model.requests.at(-1)), /600/)
    assert.deepEqual(store.dependencies(THESIS), [])
    // ...and it is no longer offered to routing either.
    await ask(app.gateway, '论文的预算部分')
    assert.equal(payloads.at(-1)!.symbols, undefined)

    // 7. Lookups follow the same rule, including a pair the user kept apart.
    store.setPrivate(QWEN, false)
    store.setManualLink(QWEN, THESIS, -1)
    steps.push(async function* () { yield* toolCall('theone_lookup', { query: '预算' }) }, say('查过了'))
    await ask(app.gateway, '论文 查一下')
    assert.deepEqual(toolOutput(model.requests.at(-1)).facts, [])
    store.setManualLink(QWEN, THESIS, 0)
    steps.push(async function* () { yield* toolCall('theone_lookup', { query: '预算' }) }, say('查过了'))
    await ask(app.gateway, '论文 再查一下')
    assert.deepEqual(toolOutput(model.requests.at(-1)).facts.map((fact: { label: string; value: string }) => [fact.label, fact.value]), [['预算', '600']])
    assert.equal(store.deliveries(THESIS).at(-1)?.via, 'lookup')
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('an acceptance of the Worker’s proposal confirms it; a stale write and an unquoted retraction are refused', { timeout: 60000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-facts-accept-'))
  const { model, steps } = world()
  const app = await harness(root, model, { routerMode: 'llm', theoneConfig: { factLinks: true } })
  try {
    const store = app.ctx.theone.store
    steps.push(say('建议场地选和平里社区活动室'))
    await ask(app.gateway, 'Qwen 活动场地你有什么建议')
    steps.push(record([{ label: '场地', kind: 'decision', value: '和平里社区活动室', evidenceQuote: '好，就按你说的来', acceptsQuote: '建议场地选和平里社区活动室' }]), say('定了'))
    await ask(app.gateway, 'Qwen 好，就按你说的来')
    const venue = store.facts(QWEN)[0]
    assert.deepEqual([venue.status, venue.evidence.speaker, !!venue.evidence.accepts], ['confirmed', 'user', true])
    // A write based on an old version is refused and reports the current value.
    steps.push(record([{ label: '场地', value: '其他地方', evidenceQuote: 'Qwen 换成其他地方', expectedVersion: 0 }]), say('好'))
    await ask(app.gateway, 'Qwen 换成其他地方')
    assert.ok(toolResult(model.requests.at(-1)).includes('rejected') && toolResult(model.requests.at(-1)).includes('the fact changed since'))
    assert.equal(store.fact(venue.id)?.value, '和平里社区活动室')
    // A retraction needs the user's own words.
    steps.push(record([{ op: 'retract', factId: venue.id, evidenceQuote: '这句话没人说过' }]), say('好'))
    await ask(app.gateway, 'Qwen 场地的事')
    assert.match(toolResult(model.requests.at(-1)), /a retraction needs the user’s own words/)
    assert.equal(store.fact(venue.id)?.status, 'confirmed')
    steps.push(record([{ op: 'retract', factId: venue.id, evidenceQuote: '场地还没定', expectedVersion: 1 }]), say('好'))
    await ask(app.gateway, 'Qwen 其实场地还没定')
    assert.equal(store.fact(venue.id)?.status, 'retracted')
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('secrets never reach storage or the router; notices and facts stay within their budgets', { timeout: 60000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-facts-safety-'))
  const { model, payloads, steps } = world()
  const app = await harness(root, model, { routerMode: 'llm', theoneConfig: { factLinks: true } })
  try {
    const store = app.ctx.theone.store
    const secret = 'sk-' + 'a1b2c3d4e5f6g7h8i9j0k1'
    steps.push(record([{ label: '接口 key', kind: 'fact', value: secret, evidenceQuote: `key 是 ${secret}` }]), say('好'))
    await ask(app.gateway, `Qwen 的 key 是 ${secret}，预算另说`)
    const stored = store.facts(QWEN)[0]
    assert.ok(stored && !JSON.stringify(stored).includes(secret))
    await ask(app.gateway, '论文 预算和 key 都用上')
    assert.ok(!JSON.stringify(payloads.at(-1)).includes(secret))
    assert.ok(!briefing(model.requests.at(-1)).includes(secret))

    // Thirty facts the thesis used all change at once: the notice section stays within its budget,
    // and the rest are told on the following turns rather than dropped.
    const many = Array.from({ length: 30 }, (_, n) => store.recordFact(QWEN, { label: `参数${n}`, kind: 'fact', value: `旧值${n}`.repeat(4), status: 'confirmed',
      evidence: { sessionId: 'x', seq: n, speaker: 'user', quote: `参数${n}` }, origin: 'worker' }).fact!)
    for (const fact of many) store.recordDelivery(THESIS, fact, 'route')
    for (const fact of many) store.recordFact(QWEN, { factId: fact.id, label: fact.label, kind: 'fact', value: `新值${fact.label}`.repeat(4), status: 'confirmed',
      evidence: { sessionId: 'x', seq: 100 + many.indexOf(fact), speaker: 'user', quote: '改' }, origin: 'worker' })
    await ask(app.gateway, '继续')
    const section = briefing(model.requests.at(-1)).split('\n\n').find(part => part.startsWith('你之前用到的其他话题要点有变化'))!
    assert.ok(section.length <= 600 + 40, `notice section is ${section.length} characters`)
    let told = section.split('\n').length - 1
    for (let turn = 0; turn < 10 && told < 30; turn++) {
      await ask(app.gateway, '继续')
      told += briefing(model.requests.at(-1)).split('\n').filter(line => line.includes('→')).length
    }
    assert.equal(told, 30)
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('with shared facts off, nothing changes: no fact tools, no candidates, no fact instructions', { timeout: 60000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-facts-off-'))
  const { model, payloads } = world()
  const app = await harness(root, model, { routerMode: 'llm' })
  try {
    app.ctx.theone.store.recordFact(QWEN, { label: '预算', kind: 'fact', value: '800', status: 'confirmed', evidence: { sessionId: 'x', seq: 1, speaker: 'user', quote: '预算 800' }, origin: 'worker' })
    await ask(app.gateway, '论文里写一下预算')
    assert.equal(payloads.at(-1)!.symbols, undefined)
    const worker = model.requests.at(-1)!
    assert.ok(!(worker.tools ?? []).some(tool => /theone_(record|lookup)/.test(tool.name)))
    assert.doesNotMatch(briefing(worker), /预算 = 800/)
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('automatic extraction is off by default; when on, it records only confirmed values and a slow one cannot overwrite a newer value', { timeout: 60000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-facts-extract-'))
  const { model, steps } = world()
  const extractions: { system: string; payload: { user: string; assistant: string; facts: unknown[] } }[] = []
  let answers: object[][] = []
  let gate: Promise<void> = Promise.resolve()
  const routed = model.behavior!
  model.behavior = async function* (options) {
    if (options.system?.startsWith('你在帮一个话题记录已经确定下来的要点')) {
      extractions.push({ system: options.system, payload: JSON.parse((options.messages[0] as unknown as { content: { text: string }[] }).content[0].text) })
      await gate
      yield* textResponse(JSON.stringify(answers.shift() ?? []))
      return
    }
    yield* routed(options)
  }
  let app = await harness(root, model, { routerMode: 'llm', theoneConfig: { factLinks: true } })
  try {
    await ask(app.gateway, 'Qwen 预算定为 800 元')
    await app.ctx.theone.extracting
    assert.equal(extractions.length, 0, 'extraction stays off unless turned on')
  } finally { await app.close() }

  app = await harness(join(root, 'on'), model, { routerMode: 'llm', theoneConfig: { factLinks: true, factExtraction: true } })
  try {
    const store = app.ctx.theone.store
    const secret = 'sk-' + 'z9y8x7w6v5u4t3s2r1q0p9'
    // The Worker answers without recording; extraction proposes two items, only the user's counts.
    steps.push(say('建议显存预留 24G'))
    answers = [[{ op: 'set', label: '预算', kind: 'fact', value: '800', evidenceQuote: '预算定为 800 元' },
      { op: 'set', label: '显存', kind: 'decision', value: '24G', evidenceQuote: '建议显存预留 24G' }]]
    await ask(app.gateway, `Qwen 预算定为 800 元，key 是 ${secret}`)
    await app.ctx.theone.extracting
    assert.equal(extractions.length, 1)
    assert.ok(!JSON.stringify(extractions[0].payload).includes(secret), 'nothing secret is sent for extraction')
    assert.ok(JSON.stringify(extractions[0].payload).length <= 6000 + 200)
    const facts = store.facts(QWEN)
    assert.deepEqual(facts.map(fact => [fact.label, fact.status, fact.origin]).sort(), [['显存', 'proposed', 'extractor'], ['预算', 'confirmed', 'extractor']])

    // Turn A's extraction is slow; turn B records a new value meanwhile. A's late result must lose.
    let release!: () => void
    gate = new Promise(resolve => { release = resolve })
    answers = [[{ op: 'set', label: '截止日期', kind: 'fact', value: '3 月 20 日', evidenceQuote: '截止日期是 3 月 20 日' }]]
    await ask(app.gateway, 'Qwen 截止日期是 3 月 20 日')
    steps.push(record([{ label: '截止日期', kind: 'fact', value: '3 月 22 日', evidenceQuote: '截止日期改成 3 月 22 日' }]), say('改好了'))
    await ask(app.gateway, 'Qwen 截止日期改成 3 月 22 日')
    release()
    await app.ctx.theone.extracting
    const deadline = store.facts(QWEN).find(fact => fact.label === '截止日期')!
    assert.deepEqual([deadline.value, deadline.version, deadline.origin], ['3 月 22 日', 1, 'worker'])
    // The turn where the Worker recorded facts itself is not extracted again.
    assert.equal(extractions.length, 2)
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('the live extraction queue retains withdrawn identities so a new confirmation restores them', { timeout: 60000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-facts-restore-'))
  const { model } = world()
  const routed = model.behavior!
  model.behavior = async function* (options) {
    if (options.system?.startsWith('你在帮一个话题记录已经确定下来的要点')) {
      const payload = JSON.parse((options.messages[0] as unknown as { content: { text: string }[] }).content[0].text)
      assert.equal(payload.facts[0].status, 'retracted')
      yield* textResponse(JSON.stringify([{ label: '预算', kind: 'fact', value: '900', evidenceQuote: '预算重新定为 900 元' }]))
      return
    }
    yield* routed(options)
  }
  const app = await harness(root, model, { routerMode: 'llm', theoneConfig: { factLinks: true, factExtraction: true } })
  try {
    const s = app.ctx.theone.store
    const fact = s.recordFact(QWEN, { label: '预算', kind: 'fact', value: '800', status: 'confirmed', origin: 'worker',
      evidence: { sessionId: 'old', seq: 1, speaker: 'user', quote: '预算 800' } }).fact!
    s.retractFact(QWEN, fact.id, { sessionId: 'old', seq: 2, speaker: 'user', quote: '预算未定' }, 'worker')
    await ask(app.gateway, 'Qwen 预算重新定为 900 元')
    await app.ctx.theone.extracting
    assert.deepEqual([s.fact(fact.id)?.status, s.fact(fact.id)?.value, s.fact(fact.id)?.version], ['confirmed', '900', 3])
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

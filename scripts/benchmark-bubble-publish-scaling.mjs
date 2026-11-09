// Uses compiled JS so the benchmark works without tsx/esbuild or test child processes.
// Burst: node scripts/benchmark-bubble-publish-scaling.mjs <compiled-root> <output.json> [active-gateways=0]
// Routing: set BUBBLE_BENCH_ROOT / BUBBLE_BENCH_OUTPUT, then preload this script with node --import.
// Equality: node scripts/benchmark-bubble-publish-scaling.mjs --compare <baseline-root> <current-root>
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { performance } from 'node:perf_hooks'

const preload = !!process.env.BUBBLE_BENCH_ROOT
const compare = !preload && process.argv[2] === '--compare'
const root = resolve(process.env.BUBBLE_BENCH_ROOT || (compare ? process.argv[4] : process.argv[2]))
const output = compare ? undefined : resolve(process.env.BUBBLE_BENCH_OUTPUT || process.argv[3])
const moduleAt = path => import(pathToFileURL(join(root, path)).href)
const [{ ContextStore }, { BubbleAggregator }, { default: TheOne }] = await Promise.all([
  moduleAt('src/store.js'), moduleAt('src/bubble-aggregator.js'), moduleAt('src/index.js'),
])
const reads = ['contexts', 'hiddenReasons', 'privateIds', 'unreachable', 'contextUsage', 'latestTopicRuns',
  'declaredTopics', 'routeTimeline', 'groups', 'mergeSuggestions', 'links', 'origins', 'current', 'route', 'sources', 'sourceRanges']

function observe() {
  let depth = 0
  const restore = [], started = performance.now()
  const stats = { requests: 0, cuts: 0, projections: 0, publicationMs: 0, decodedDescriptors: 0, publicationDecodedDescriptors: 0,
    reads: Object.fromEntries(reads.map(key => [key, 0])), publicationReads: Object.fromEntries(reads.map(key => [key, 0])) }
  function wrap(proto, name, make) {
    const original = proto[name]
    if (!original) return
    proto[name] = make(original)
    restore.push(() => { proto[name] = original })
  }
  for (const name of reads) wrap(ContextStore.prototype, name, original => function (...args) {
    const result = original.apply(this, args)
    stats.reads[name]++
    if (depth) stats.publicationReads[name]++
    if (name === 'contexts') {
      stats.decodedDescriptors += result.length
      if (depth) stats.publicationDecodedDescriptors += result.length
    }
    return result
  })
  for (const name of ['publish', 'flush']) wrap(BubbleAggregator.prototype, name, original => function (...args) {
    if (name === 'publish') stats.requests++
    const outer = depth++ === 0, before = performance.now(), projections = stats.projections
    try { return original.apply(this, args) }
    finally {
      depth--
      if (outer) {
        stats.publicationMs += performance.now() - before
        if (stats.projections > projections) stats.cuts++
      }
    }
  })
  if (TheOne.prototype.prepareBubblePublication) {
    wrap(TheOne.prototype, 'prepareBubblePublication', original => function (...args) {
      const publication = original.apply(this, args), project = publication.project
      publication.project = id => { stats.projections++; return project(id) }
      return publication
    })
  } else {
    wrap(TheOne.prototype, 'bubbleView', original => function (...args) { stats.projections++; return original.apply(this, args) })
  }
  return {
    finish(scenario) {
      for (const undo of restore.reverse()) undo()
      // Source and route lookups are reported separately from full shared-fact reads.
      const shared = reads.filter(name => !['sources', 'sourceRanges', 'route'].includes(name))
      const result = { scenario, node: process.version, compiledRoot: root, wallMs: performance.now() - started, ...stats,
        sharedReads: shared.reduce((n, key) => n + stats.reads[key], 0),
        publicationSharedReads: shared.reduce((n, key) => n + stats.publicationReads[key], 0) }
      writeFileSync(output, JSON.stringify(result, null, 2) + '\n')
      console.log(JSON.stringify(result))
      return result
    },
  }
}

if (compare) {
  const { projectBubbles: before } = await import(pathToFileURL(join(resolve(process.argv[3]), 'src/bubble-projection.js')).href)
  const { projectBubbles: after, readBubbleProjection } = await moduleAt('src/bubble-projection.js')
  const store = new ContextStore(':memory:'), now = 1_800_000_000_000
  try {
    const ids = Array.from({ length: 12 }, (_, i) => 'topic-' + String(i).padStart(2, '0'))
    store.seed(ids.map((id, i) => ({ id, title: `Qwen ${i}`, label: i % 2 ? 'Qwen' : undefined, summary: '', lastState: '',
      entities: ['Qwen', 'shared-' + i % 3], keywords: [] })))
    const dates = new Map()
    ids.forEach((id, i) => {
      store.plan('m' + i, 'g' + i % 2, 'test', { action: 'KEEP', contextId: id, reason: 'fixture' }, false)
      store.startTopicRun('m' + i, id, 'worker-' + i, now - 1000)
      if (i % 3) store.endTopicRun('m' + i, 'completed', now - 500)
      if (i % 4 === 0) store.declareTopic(id, 'done', now - 100)
      if (i % 3 === 0) store.setPrivate(id, true)
      store.attachSession(id, 'source-' + i); dates.set('source-' + i, now - i)
    })
    store.moveTopic(ids[0], { title: 'Workspace' })
    for (const id of ids.slice(1, 4)) store.moveTopic(id, { groupId: store.groups()[0].id })
    store.setManualLink(ids[0], ids[1], -1, now)
    store.setManualLink(ids[2], ids[3], 1, now)
    store.learnLink(ids[4], ids[5], 0.8, now)
    store.createMergeSuggestion(ids[6], ids[7], { gatewayKey: 'test', gatewayId: 'g0' }, { sharedNames: 1, titleSimilarity: 0.8 }, now + 60000, now)
    store.branchTopic(ids[0], 'Branch one', 'branch-worker-1', 'project')
    store.branchTopic(ids[0], 'Branch two', 'branch-worker-2', 'project')
    const workItems = ids.slice(0, 6).map((id, i) => ({ id: 'work-' + i, gatewayId: 'g' + i % 2, primaryMessageId: 'm' + i,
      messageIds: ['m' + i], batchId: null, source: 'user', contextId: id, executionId: 'run-' + i, lane: 'foreground',
      phase: i % 2 ? 'waiting_user' : 'succeeded', outcome: i % 2 ? undefined : 'completed', updatedAt: now - 50,
      delivery: { phase: 'waiting', shownSteps: 0, committedSteps: 0, commit: null }, stop: { allowed: false, reason: 'unsupported' } }))
    let comparisons = 0
    for (const hidden of [[], [{ id: ids[0], reason: 'archived' }, { id: ids[6], reason: 'archived' }],
      [{ id: ids[1], reason: 'excluded' }, { id: ids[2], reason: 'orphaned' }]]) {
      store.replaceHidden(hidden)
      for (const linkScope of ['auto', 'workspace', 'off']) for (const busy of [false, true]) {
        const shared = readBubbleProjection(store, 'test', { now, linkScope, sessionCreatedAt: dates })
        for (const gatewayId of [null, 'g0', 'g1', 'cold']) for (const withLiveWork of [false, true]) {
          const input = { scope: { gatewayKey: 'test', gatewayId }, now, linkScope, busy, sessionCreatedAt: dates,
            workItems: withLiveWork ? workItems : [], doneCapabilities: new Map([[ids[6], { allowed: false, reason: 'pending_delivery' }]]),
            gateway: gatewayId ? { id: gatewayId, currentId: null, showingExecutionId: null, nextTurn: [], nextStep: [], claimed: [] } : null }
          assert.deepEqual(after(store, { ...input, shared }), before(store, input))
          comparisons++
        }
      }
    }
    console.log(JSON.stringify({ comparisons, result: 'all projections identical to baseline' }))
  } finally { store.close() }
} else if (preload) {
  const observer = observe()
  process.once('exit', () => observer.finish('original native gateway routing test (70 extra topics, three messages)'))
} else {
  const active = Number(process.argv[4] || 0)
  assert.ok(active === 0 || active === 30, 'active-gateways must be 0 or 30')
  const { harness } = await moduleAt('tests/harness.js')
  const directory = await mkdtemp(join(tmpdir(), 'theone-bubble-benchmark-'))
  const app = await harness(directory, undefined, { historyCatalog: true })
  try {
    const service = app.ctx.theone, store = service.store
    store.seed(Array.from({ length: 300 - store.contexts().length }, (_, i) => ({ id: `benchmark-${String(i).padStart(3, '0')}`,
      title: `Topic ${i}`, summary: '', entities: [], keywords: [], lastState: '' })))
    for (let i = 0; i < 29; i++) store.rememberGateway('test-gateway', `gateway-${i}`)
    store.rememberGateway('test-gateway', app.gateway.id)
    if (active) for (const gatewayId of store.gatewayIds('test-gateway')) service.bubbles.read({ gatewayId })
    await new Promise(resolve => setImmediate(resolve))
    const topics = store.contexts()
    assert.equal(topics.length, 300)
    assert.equal(store.gatewayIds('test-gateway').length, 30)
    const observer = observe()
    for (let i = 0; i < 50; i++) store.setManualLink(topics[0].id, topics[i + 1].id, i % 2 ? -1 : 1)
    await Promise.resolve()
    const result = observer.finish(`300 topics x 30 gateways x 50 link writes; ${active} explicitly read gateways`)
    assert.equal(service.bubbles.read().kind, 'update')
    assert.ok(result.projections > 0, 'publication instrumentation must observe real projections')
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }) }
}

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { foamContour, foamEnterActs, foamFilter, foamHitRadii, foamLabel, foamMergeReason, foamMerging, foamNearest, foamOrder, foamPlace, foamPoreHits, foamShortName, foamStatusText, type FoamTopic } from '../src/client-foam.ts'
import { foamEventsFrom, mergeOutcomes, modelFromBubbles, modelFromCatalog, settleFoamEvents, suggestionsFromBubbles } from '../src/client-foam-host.ts'
import type { CatalogSnapshot } from '../src/catalog-types.ts'
import type { BubbleEvent, BubbleMerge, BubbleSnapshot, BubbleTopic, BubbleWorkItem } from '../src/bubble-types.ts'

const NOW = 1_800_000_000_000, DAY = 86400000
const allowed = { allowed: true }
const topic = (id: string, extra: Partial<BubbleTopic> = {}): BubbleTopic => ({ id, title: id, label: null, openSessionId: 'worker-' + id, topicRevision: null, current: false, lifecycle: 'active', declaredDoneAt: null, effectiveDone: false,
  archived: false, private: false, groupId: null, project: null, usage: { completedCalls: 0, recentCalls: 0, lastUsedAt: null }, lastActivityAt: null, workItemIds: [],
  capabilities: { mount: allowed, declareDone: allowed, mergeNow: allowed, queueMerge: allowed, delete: allowed }, ...extra })
const work = (id: string, contextId: string, phase: BubbleWorkItem['phase'], extra: Partial<BubbleWorkItem> = {}): BubbleWorkItem => ({ id, gatewayId: 'g', primaryMessageId: 'm-' + id,
  messageIds: ['m-' + id], batchId: null, source: 'user', contextId, executionId: 'x-' + id, lane: 'background', phase,
  delivery: { phase: 'waiting', shownSteps: 0, committedSteps: 0, commit: null }, updatedAt: NOW - 5000, stop: allowed, ...extra })
const snapshot = (topics: BubbleTopic[], workItems: BubbleWorkItem[] = [], edges: BubbleSnapshot['edges'] = []): BubbleSnapshot => ({ schemaVersion: 1,
  scope: { gatewayKey: 'default', gatewayId: 'g' }, cursor: { epoch: 'e', version: 1, seq: 0 }, eventFloor: 0, serverTime: NOW,
  topics, workItems, gateway: null, edges, merges: [], health: { catalog: 'ready', router: 'ready' } })

test('a topic keeps its short label, and merges still waiting hold their two cells together', () => {
  const snap = snapshot([topic('a', { title: '想去日本旅游，帮我看看行程', label: '日本' }), topic('b'), topic('c')])
  const merge = (operationId: string, sourceId: string, state: BubbleSnapshot['merges'][number]['state']) =>
    ({ operationId, requestId: operationId, sourceId, targetId: 'b', whenIdle: true, state, createdAt: NOW, updatedAt: NOW, expiresAt: NOW + 300000 })
  snap.merges = [merge('1', 'a', 'queued'), merge('2', 'c', 'cancelled')]
  const model = modelFromBubbles(snap)
  assert.equal(model.topics[0].label, '日本')
  assert.equal(model.topics[1].label, undefined)
  assert.deepEqual(model.pendingMerges, [{ id: 'a', into: 'b', state: 'queued', operationId: '1' }])
})

test('a topic shows what its work is doing: waiting on the user first, then answering, answered, queued, failed', () => {
  const model = modelFromBubbles(snapshot([topic('a'), topic('b'), topic('c'), topic('d'), topic('e'), topic('f')], [
    work('1', 'a', 'running'), work('2', 'a', 'waiting_user'),
    work('3', 'b', 'starting'),
    work('4', 'c', 'succeeded'),
    work('5', 'd', 'succeeded', { delivery: { phase: 'shown', shownSteps: 1, committedSteps: 1, commit: null } }),
    work('6', 'e', 'queued'),
    work('7', 'f', 'failed', { delivery: { phase: 'discarded', shownSteps: 0, committedSteps: 0, commit: null } }),
  ]))
  assert.deepEqual(model.topics.map(t => t.phase), ['waiting', 'running', 'answered', 'idle', 'queued', 'failed'])
})

test('recent and often used topics weigh more; idle done or archived topics are set aside, busy or current ones never', () => {
  const model = modelFromBubbles(snapshot([
    topic('fresh', { usage: { completedCalls: 9, recentCalls: 9, lastUsedAt: NOW - DAY / 4 } }),
    topic('old', { usage: { completedCalls: 2, recentCalls: 0, lastUsedAt: NOW - 20 * DAY } }),
    topic('done', { effectiveDone: true }),
    topic('busyDone', { effectiveDone: true }),
    topic('archivedCurrent', { archived: true, current: true }),
  ], [work('1', 'busyDone', 'running')], [{ a: 'fresh', b: 'old', relation: 'kept_apart', strength: 1, manual: -1, reasons: ['manual'] }]))
  const by = Object.fromEntries(model.topics.map(t => [t.id, t]))
  assert.ok(by.fresh.weight > .6 && by.old.weight < .05, `${by.fresh.weight} ${by.old.weight}`)
  assert.equal(by.done.aside, true)
  assert.equal(by.busyDone.aside, false)
  assert.equal(by.archivedCurrent.aside, false)
  assert.ok(model.links![0].weight < 0)
})

test('routing events become cluster events; hints and bookkeeping play nothing', () => {
  const snap = snapshot([topic('a'), topic('b'), topic('c')], [work('w1', 'a', 'running'), work('w2', 'b', 'running', { source: 'steering' })])
  const meta = { version: 2, at: NOW, gatewayId: 'g' }
  const events: BubbleEvent[] = [
    { ...meta, seq: 1, type: 'route.assigned', workItemId: 'w1', messageIds: ['m1'], contextId: 'a', action: 'SWAP', created: false, relatedProposedIds: ['c'], alternateIds: ['c'] },
    { ...meta, seq: 2, type: 'route.assigned', workItemId: 'w2', messageIds: ['m2'], contextId: 'b', action: 'KEEP', created: false, relatedProposedIds: [], alternateIds: [] },
    { ...meta, seq: 3, type: 'route.assigned', workItemId: 'w3', messageIds: ['m3'], contextId: 'c', action: 'CREATE', created: true, relatedProposedIds: [], alternateIds: [] },
    { ...meta, seq: 4, type: 'route.blocked', workItemId: 'w4', reason: 'correction_unclear', candidateIds: ['a', 'b'] },
    { ...meta, seq: 5, type: 'route.hint', messageId: 'm1', suggestedId: 'b' },
    { ...meta, seq: 6, type: 'route.moved', messageId: 'm1', fromId: 'a', toId: 'b', cause: 'explicit', reexecute: false },
    { ...meta, seq: 7, type: 'work.changed', workItemId: 'w1', executionId: 'x', phase: 'running' },
    { ...meta, seq: 8, type: 'topic.merged', sourceId: 'd', targetId: 'a' },
  ]
  assert.deepEqual(foamEventsFrom(events, snap), [
    { kind: 'route', to: 'a', alternates: ['c'], messageId: 'm1' },
    { kind: 'supplement', to: 'b' },
    { kind: 'create', to: 'c' },
    { kind: 'clarify', candidates: ['a', 'b'] },
    { kind: 'correct', from: 'a', to: 'b', messageId: 'm1' },
    { kind: 'merged', id: 'd', into: 'a' },
  ])
})

test('a cell shows its whole name or none of it, never a clipped name', () => {
  const names = ['猫粮', '日语', '跑鞋', '学吉他', '显卡选购', '周末书单', '换季衣物', '面试准备材料', '一个特别特别长的话题名字', 'Budget', 'Kubernetes upgrade']
  for (const name of names) for (let radius = 12; radius <= 34; radius += 1) {
    const { lines } = foamLabel(name, radius)
    assert.ok(lines.length === 0 || lines.join('') === name, `${name} at ${radius}: ${JSON.stringify(lines)}`)
    assert.ok(!lines.join('').includes('…'))
    assert.ok(lines.length <= 2)
  }
})

test('a long title gives the cell a whole phrase from it, or the topic short label, never a clipped piece', () => {
  assert.equal(foamShortName('想去日本旅游，帮我看看行程'), '想去日本旅游')
  assert.equal(foamShortName('周报这周要写什么'), '周报这周要写什么')
  assert.equal(foamShortName('周报这周要写什么', '周报'), '周报')
  assert.equal(foamShortName('（草稿）年终总结'), '草稿')
  // A full-size cell takes six or eight characters on two lines and nine on three.
  assert.deepEqual(foamLabel('想去日本旅游', 29).lines, ['想去日', '本旅游'])
  assert.deepEqual(foamLabel('周报这周要写什么', 29).lines, ['周报这周', '要写什么'])
  assert.deepEqual(foamLabel('帮我看看这周的周报', 29).lines, ['帮我看', '看这周', '的周报'])
})

test('a full-size cell holds a four-character name on one line; a small one splits it in two', () => {
  assert.deepEqual(foamLabel('显卡选购', 29).lines, ['显卡选购'])
  assert.deepEqual(foamLabel('显卡选购', 20).lines, ['显卡', '选购'])
  assert.deepEqual(foamLabel('猫粮', 18).lines, ['猫粮'])
  assert.deepEqual(foamLabel('显卡选购', 12).lines, [])
})

test('the directory feeds the cluster: hidden topics drop out, done and archived ones are set aside, links are undirected', () => {
  const context = (id: string, title: string, extra: object = {}) => ({ id, title, summary: '', entities: [], keywords: [], lastState: '', workingSessionId: 'w-' + id, sourceSessionIds: [], ...extra })
  const snapshot = {
    groups: [{ id: 'g1', title: '家', summary: '', contextIds: ['a', 'b'] }],
    contexts: [context('a', '搬家清单', { topicStatus: 'active' }), context('b', '租房合同', { topicStatus: 'waiting' }), context('c', '旧话题', { hidden: 'orphaned' }),
      context('d', '基金定投', { topicStatus: 'done' }), context('e', '日语', { hidden: 'archived' })],
    status: { running: false, scanned: 0, indexed: 0, skipped: 0, failed: 0, pending: 0 },
    linkage: { scope: 'auto', topics: {
      a: { private: false, related: [{ id: 'b', title: '租房合同', reasons: ['workspace'] }] },
      b: { private: false, related: [{ id: 'a', title: '搬家清单', reasons: ['workspace'] }, { id: 'd', title: '基金定投', reasons: ['learned'] }] },
    } },
  } as unknown as CatalogSnapshot
  const model = modelFromCatalog(snapshot)
  assert.deepEqual(model.topics.map(topic => topic.id), ['a', 'b', 'd', 'e'])
  const byId = Object.fromEntries(model.topics.map(topic => [topic.id, topic]))
  assert.equal(byId.a.group, 'g1')
  assert.equal(byId.b.phase, 'waiting')
  assert.equal(byId.d.aside, true)
  assert.equal(byId.e.aside, true)
  assert.equal(byId.a.aside, false)
  assert.deepEqual(model.links, [{ a: 'a', b: 'b', weight: .3 }, { a: 'b', b: 'd', weight: .5 }])
})

test('the rendered curve stays below the header even when smoothing rises above its vertices', () => {
  // All vertices clear y=9, but the top Bezier bows above them; checking the vertices alone is insufficient.
  const points = [[0, 10], [10, 10], [10, 30], [0, 30]]
  const contour = foamContour(points, 9)
  const coords = contour.path.match(/-?\d+(?:\.\d+)?/g)!.map(Number)
  const ys = coords.filter((_, i) => i % 2 === 1)
  assert.ok(Math.min(...ys) >= 9, `rendered controls cross header: ${Math.min(...ys)}`)
  assert.ok(contour.offsetY > 0)
  // Move the whole shape, including the centre used for labels/hits, without squashing it or mutating the input.
  assert.deepEqual(points, [[0, 10], [10, 10], [10, 30], [0, 30]])
  assert.deepEqual(contour.points.map(p => p[0]), [0, 10, 10, 0])
  assert.ok(Math.abs(contour.points[2][1] - contour.points[0][1] - 20) < 1e-9)
  assert.ok(Math.abs(contour.points[0][1] - points[0][1] - contour.offsetY) < 1e-9)
  assert.equal(foamContour(contour.points, 9).offsetY, 0)
})

test('unconstrained dragging keeps its contour above the header and a clear contour does not move', () => {
  const points = [[0, -30], [10, -10], [0, 10], [-10, -10]]
  const drag = foamContour(points)
  assert.equal(drag.offsetY, 0)
  assert.deepEqual(drag.points, points)
  assert.ok(drag.path.startsWith('M0.00 -30.00'))
  assert.equal(foamContour([[0, 40], [10, 50], [0, 60], [-10, 50]], 9).offsetY, 0)
})

test('a small cell alone gets a 24px hit circle; a big one keeps its own outline', () => {
  const box = { w: 300, h: 200 }
  assert.deepEqual(foamHitRadii([{ x: 100, y: 100, r: 6 }], box), [12])
  assert.deepEqual(foamHitRadii([{ x: 100, y: 100, r: 29 }], box), [29])
})

test('hit circles split the room between neighbours by size and never reach into each other', () => {
  const box = { w: 300, h: 200 }
  // Two small cells 16px apart: 8 each, they meet but do not overlap.
  assert.deepEqual(foamHitRadii([{ x: 100, y: 100, r: 6 }, { x: 116, y: 100, r: 6 }], box), [8, 8])
  // A small cell next to a bigger one: the free 4px is split evenly, so the small one never covers the big one's outline.
  const [small, big] = foamHitRadii([{ x: 100, y: 100, r: 6 }, { x: 120, y: 100, r: 10 }], box)
  assert.equal(small, 8); assert.equal(big, 12)
  assert.ok(small + 10 <= 20 && big + 6 <= 20)
  // Many random layouts whose outlines do not overlap: hit circles never overlap and never shrink below the outline's floor.
  let seed = 7
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  for (let round = 0; round < 300; round++) {
    const items: { x: number; y: number; r: number; floor: number }[] = []
    for (let tries = 0; items.length < 12 && tries < 200; tries++) {
      const r = 4 + rnd() * 14, it = { x: rnd() * 300, y: rnd() * 200, r, floor: r * (.7 + rnd() * .3) }
      if (items.every(o => Math.hypot(o.x - it.x, o.y - it.y) >= o.floor + it.floor)) items.push(it)
    }
    const h = foamHitRadii(items, box)
    items.forEach((a, i) => {
      assert.ok(h[i] >= a.floor - 1e-9, `floor ${i}`)
      items.forEach((b, j) => { if (j > i) assert.ok(h[i] + h[j] <= Math.hypot(a.x - b.x, a.y - b.y) + 1e-9, `overlap ${i}-${j} in round ${round}`) })
    })
  }
})

test('a hit circle never reaches past the cluster box, but never shrinks below the cell outline', () => {
  const box = { w: 300, h: 40 }
  assert.deepEqual(foamHitRadii([{ x: 150, y: 9, r: 6 }], box), [9])
  assert.deepEqual(foamHitRadii([{ x: 150, y: 3, r: 6 }], box), [6])
  assert.deepEqual(foamHitRadii([{ x: 150, y: 3, r: 6, floor: 5 }], box), [5])
})

test('a header exclusion bounds even an oversized hit floor and leaves the header gap unclickable', () => {
  const box = { w: 300, h: 100, top: 8 }
  // A rail cell can have less room above it than the minimum touch target or its outline floor.
  assert.deepEqual(foamHitRadii([{ x: 150, y: 14, r: 9, floor: 9 }], box), [6])
  assert.deepEqual(foamHitRadii([{ x: 150, y: 4, r: 9, floor: 9 }], box), [0])
  assert.deepEqual(foamHitRadii([{ x: 150, y: 50, r: 9 }], box), [12])
  const porous = foamPoreHits([{ x: 50, y: 14, r: 9 }], [{ x: 150, y: 14 }], box)
  assert.deepEqual(porous, { cells: [6], pores: [6] })
})

test('a press goes to the nearest centre among the circles that hold it', () => {
  const items = [{ x: 0, y: 0, r: 12 }, { x: 16, y: 0, r: 12 }]
  assert.equal(foamNearest({ x: 7, y: 0 }, items), 0)
  assert.equal(foamNearest({ x: 9, y: 0 }, items), 1)
  assert.equal(foamNearest({ x: 40, y: 0 }, items), -1)
  // A big neighbour's circle holds the point too, but the small cell's centre is nearer.
  assert.equal(foamNearest({ x: 22, y: 0 }, [{ x: 0, y: 0, r: 30 }, { x: 26, y: 0, r: 8 }]), 1)
})

test('a hint sits above its cell, flips below when there is no room, and stays whole on all four sides', () => {
  const view = { w: 400, h: 300 }, cell = { left: 100, top: 100, right: 120, bottom: 120 }
  assert.deepEqual(foamPlace({ w: 80, h: 24 }, cell, view), { left: 70, top: 70, side: 'above' })
  assert.deepEqual(foamPlace({ w: 80, h: 24 }, { left: 100, top: 10, right: 120, bottom: 30 }, view), { left: 70, top: 36, side: 'below' })
  // Near the left and right edges the hint slides in instead of going off screen.
  assert.equal(foamPlace({ w: 200, h: 24 }, { left: 0, top: 100, right: 10, bottom: 110 }, view).left, 8)
  assert.equal(foamPlace({ w: 200, h: 24 }, { left: 390, top: 100, right: 400, bottom: 110 }, view).left, 192)
  // Wider than the viewport: pinned to the left margin (CSS max-width keeps it from being wider in practice).
  assert.equal(foamPlace({ w: 500, h: 24 }, cell, view).left, 8)
  // No room either way: the roomier side, held inside the margins.
  const tall = foamPlace({ w: 80, h: 200 }, { left: 100, top: 120, right: 120, bottom: 140 }, view)
  assert.equal(tall.side, 'below'); assert.equal(tall.top, 92)
})

test('a menu opens at the pointer, flips left and up near the edges, and never leaves the viewport', () => {
  const view = { w: 400, h: 300 }, at = (x: number, y: number) => ({ left: x, top: y, right: x, bottom: y })
  const opts = { side: 'below' as const, align: 'start' as const, gap: 2 }
  assert.deepEqual(foamPlace({ w: 170, h: 120 }, at(50, 50), view, opts), { left: 50, top: 52, side: 'below' })
  assert.deepEqual(foamPlace({ w: 170, h: 120 }, at(350, 250), view, opts), { left: 180, top: 128, side: 'above' })
  // Taller than the viewport (CSS caps it and scrolls): starts at the top margin.
  assert.equal(foamPlace({ w: 170, h: 400 }, at(50, 50), view, opts).top, 8)
})

const say = (key: string) => key
const foam = (id: string, extra: Partial<FoamTopic> = {}): FoamTopic => ({ id, title: id, weight: .5, phase: 'idle', ...extra })

test('details say only what the work items support: which kind of running, question or approval, and why it is queued', () => {
  const model = modelFromBubbles(snapshot([topic('a'), topic('b'), topic('c'), topic('d'), topic('e'), topic('f'), topic('g'), topic('h')], [
    work('1', 'a', 'routing'),
    work('2', 'b', 'starting'), work('3', 'b', 'recovering'),
    work('4', 'c', 'waiting_user', { waits: [{ kind: 'approval', referenceId: 'r', ownerSessionId: 's' }] }),
    work('5', 'd', 'waiting_user', { waits: [{ kind: 'approval', referenceId: 'r', ownerSessionId: 's' }, { kind: 'question', referenceId: 'q', ownerSessionId: 's' }] }),
    work('6', 'e', 'waiting_user'),
    work('7', 'f', 'queued', { queueReason: 'project_busy' }),
    work('8', 'g', 'queued'),
    work('9', 'h', 'running'), work('10', 'h', 'starting'),
  ]))
  assert.deepEqual(model.topics.map(t => [t.phase, t.status, t.queueReason]), [
    ['running', 'routing', undefined], ['running', 'recovering', undefined], ['waiting', 'approval', undefined], ['waiting', 'question', undefined],
    ['waiting', 'waiting', undefined], ['queued', 'queued', 'project_busy'], ['queued', 'queued', undefined], ['running', 'running', undefined],
  ])
  assert.equal(foamStatusText(model.topics[0], say), 'statusRouting')
  assert.equal(foamStatusText(model.topics[2], say), 'statusApproval')
  assert.equal(foamStatusText(model.topics[5], say), 'queueProject')
  assert.equal(foamStatusText(model.topics[6], say), 'statusQueued')
})

test('the status line: current is its own part, a plain idle topic says nothing, set aside shows only when idle', () => {
  assert.equal(foamStatusText(foam('a'), say), '')
  assert.equal(foamStatusText(foam('a', { current: true }), say), 'statusCurrent')
  assert.equal(foamStatusText(foam('a', { current: true, phase: 'running' }), say), 'statusCurrent · statusRunning')
  assert.equal(foamStatusText(foam('a', { aside: true }), say), 'statusAside')
  // Without a finer status the phase stands in (the catalog feed), and an answer is "not yet shown", never "shown next".
  assert.equal(foamStatusText(foam('a', { phase: 'answered' }), say), 'statusAnswered')
  assert.equal(foamStatusText(foam('a', { phase: 'waiting' }), say), 'statusWaiting')
  assert.equal(foamStatusText(foam('a', { phase: 'failed' }), say), 'statusFailed')
  assert.equal(foamStatusText(foam('a', { phase: 'queued', queueReason: 'capacity' }), say), 'queueCapacity')
  assert.equal(foamStatusText(foam('a', { phase: 'queued', queueReason: 'host_queue' }), say), 'statusQueued')
})

test('the all-topics list: current first, then busy ones, then the rest, set-aside last, recent first, ties by name', () => {
  const list = [
    foam('old', { lastActive: 100 }), foam('aside', { aside: true, lastActive: 900 }), foam('fresh', { lastActive: 800 }),
    foam('busyOld', { phase: 'running', lastActive: 50 }), foam('cur', { current: true, lastActive: 10 }), foam('wait', { phase: 'waiting', lastActive: 700 }),
    foam('b', { title: '乙' }), foam('a', { title: '甲' }), foam('aside2', { aside: true, lastActive: 1 }),
  ]
  const order = foamOrder(list).map(t => t.id)
  assert.equal(order[0], 'cur')
  assert.deepEqual(order.slice(1, 3), ['wait', 'busyOld'])
  assert.deepEqual(order.slice(3, 5), ['fresh', 'old'])
  assert.deepEqual(order.slice(-2), ['aside', 'aside2'])
  assert.deepEqual(foamOrder([...list].reverse()).map(t => t.id), order)
  assert.deepEqual(list.map(t => t.id)[0], 'old', 'the input is left as it was')
})

test('type-to-filter is a plain case-insensitive substring of the title or the short label', () => {
  const list = [foam('1', { title: '想去日本旅游，帮我看看行程', label: '日本' }), foam('2', { title: 'Kubernetes upgrade' }), foam('3', { title: '周报', label: 'Weekly' })]
  assert.deepEqual(foamFilter(list, '').map(t => t.id), ['1', '2', '3'])
  assert.deepEqual(foamFilter(list, '  ').map(t => t.id), ['1', '2', '3'])
  assert.deepEqual(foamFilter(list, '行程').map(t => t.id), ['1'])
  assert.deepEqual(foamFilter(list, 'KUBER').map(t => t.id), ['2'])
  assert.deepEqual(foamFilter(list, 'week').map(t => t.id), ['3'])
  assert.deepEqual(foamFilter(list, 'k').map(t => t.id), ['2', '3'])
  assert.deepEqual(foamFilter(list, '日本 旅游').map(t => t.id), [])
})

test('possible duplicates reach the cluster: pending, in time, both topics shown, neither already merging, both directions kept', () => {
  const snap = snapshot([topic('a'), topic('b'), topic('c'), topic('d'), topic('e'), topic('f')])
  const suggestion = (suggestionId: string, a: string, b: string, extra: Partial<NonNullable<BubbleSnapshot['mergeSuggestions']>[number]> = {}): NonNullable<BubbleSnapshot['mergeSuggestions']>[number] => ({
    suggestionId, scope: { gatewayKey: 'default', gatewayId: 'g' }, pair: [a, b], directions: [{ sourceId: b, targetId: a }, { sourceId: a, targetId: b }],
    evidence: { sharedNames: 2, titleSimilarity: .8 }, createdAt: NOW - 1000, updatedAt: NOW - 1000, expiresAt: NOW + 1800000, state: 'pending', ...extra })
  snap.mergeSuggestions = [
    suggestion('s1', 'a', 'b'),
    suggestion('s2', 'a', 'c', { state: 'declined' }),
    suggestion('s3', 'b', 'c', { expiresAt: NOW - 1 }),
    suggestion('s4', 'c', 'gone'),
    suggestion('s5', 'd', 'e'),
    suggestion('s6', 'c', 'e', { directions: [{ sourceId: 'c', targetId: 'e' }, { sourceId: 'x', targetId: 'c' }] }),
  ]
  snap.merges = [{ operationId: 'o', requestId: 'r', sourceId: 'd', targetId: 'f', whenIdle: true, state: 'queued', createdAt: NOW, updatedAt: NOW, expiresAt: NOW + 300000 }]
  assert.deepEqual(modelFromBubbles(snap).suggestions, [
    { id: 's1', a: 'a', b: 'b', directions: [{ sourceId: 'b', targetId: 'a' }, { sourceId: 'a', targetId: 'b' }] },
    { id: 's6', a: 'c', b: 'e', directions: [{ sourceId: 'c', targetId: 'e' }] },
  ])
})

test('an older back end without merge suggestions gives the cluster none', () => {
  const snap = snapshot([topic('a'), topic('b')])
  assert.deepEqual(suggestionsFromBubbles(snap), [])
  assert.deepEqual(modelFromBubbles(snap).suggestions, [])
})

test('the Enter that confirms an input method candidate never acts on a row', () => {
  assert.equal(foamEnterActs({ key: 'Enter' }), true)
  assert.equal(foamEnterActs({ key: 'Enter', isComposing: false, keyCode: 13 }), true)
  assert.equal(foamEnterActs({ key: 'Enter', isComposing: true, keyCode: 13 }), false)
  assert.equal(foamEnterActs({ key: 'Enter', keyCode: 229 }), false)
  assert.equal(foamEnterActs({ key: 'Process', keyCode: 229 }), false)
  assert.equal(foamEnterActs({ key: 'a' }), false)
})

test('a topic in a merge waiting to happen, as source or target, is not offered as a merge target', () => {
  const held = foamMerging([{ id: 'b', into: 'c', state: 'queued', operationId: 'o1' }], [['d', 'e']])
  assert.deepEqual([...held].sort(), ['b', 'c', 'd', 'e'])
  assert.equal(held.has('a'), false)
  assert.deepEqual([...foamMerging(undefined)], [])
})

test('a merge that did not happen says why when TheOne gave a known reason, and the generic line otherwise', () => {
  assert.equal(foamMergeReason('MERGE_CONFLICT'), 'mergeConflict')
  assert.equal(foamMergeReason('GATEWAY_BUSY'), 'mergeBusy')
  assert.equal(foamMergeReason('TOPIC_BUSY'), 'mergeBusy')
  assert.equal(foamMergeReason('MERGE_EXPIRED'), 'mergeExpired')
  assert.equal(foamMergeReason('MERGE_FAILED'), 'mergeFailed')
  assert.equal(foamMergeReason(), 'mergeFailed')
})

const op = (operationId: string, state: BubbleMerge['state'], error?: string) => ({ operationId, sourceId: 'a', targetId: 'b', state, ...error ? { error } : {} })

test('a queued merge ends exactly once, and a history read after its receipt never takes it back', () => {
  const seen = new Map<string, BubbleMerge['state']>()
  assert.deepEqual(mergeOutcomes(seen, [op('1', 'queued')]), [])
  // The receipt says succeeded; the replayed history (executing, then succeeded) comes after it in the same read.
  assert.deepEqual(mergeOutcomes(seen, [op('1', 'succeeded'), op('1', 'executing'), op('1', 'succeeded')]), [{ kind: 'merged', id: 'a', into: 'b', undo: true }])
  assert.equal(seen.get('1'), 'succeeded')
  // Read again next round: nothing more.
  assert.deepEqual(mergeOutcomes(seen, [op('1', 'executing'), op('1', 'succeeded')]), [])
})

test('a failed queued merge passes its reason on; a cancelled one is not a failure; one never seen waiting reports nothing', () => {
  const seen = new Map<string, BubbleMerge['state']>([['2', 'executing'], ['3', 'queued']])
  assert.deepEqual(mergeOutcomes(seen, [op('2', 'failed', 'MERGE_CONFLICT'), op('3', 'cancelled', 'MERGE_RESTARTED'), op('4', 'failed', 'GATEWAY_BUSY')]), [
    { kind: 'mergeEnded', id: 'a', into: 'b', failed: true, error: 'MERGE_CONFLICT' },
    { kind: 'mergeEnded', id: 'a', into: 'b', failed: false, error: 'MERGE_RESTARTED' },
  ])
  // Back to queued while TheOne is busy is not an end.
  const later = new Map<string, BubbleMerge['state']>([['5', 'executing']])
  assert.deepEqual(mergeOutcomes(later, [op('5', 'queued')]), [])
  assert.equal(later.get('5'), 'queued')
})

test('merged and undone in one batch: the topic the latest state still has is never animated away', () => {
  const snap = snapshot([topic('a'), topic('b')])
  const meta = { version: 2, at: NOW, gatewayId: 'g' }
  const events: BubbleEvent[] = [
    { ...meta, seq: 1, type: 'topic.merged', sourceId: 'a', targetId: 'b' },
    { ...meta, seq: 2, type: 'topic.unmerged', sourceId: 'a', targetId: 'b' },
  ]
  assert.deepEqual(foamEventsFrom(events, snap), [{ kind: 'unmerged', id: 'a', into: 'b' }])
  // Undone, then merged again: only the merge plays.
  assert.deepEqual(foamEventsFrom([...events, { ...meta, seq: 3, type: 'topic.merged', sourceId: 'a', targetId: 'b' }], snapshot([topic('b')])), [{ kind: 'merged', id: 'a', into: 'b' }])
  // The queued merge's receipt is held to the same rule.
  assert.deepEqual(settleFoamEvents([{ kind: 'merged', id: 'a', into: 'b', undo: true }, { kind: 'mergeEnded', id: 'c', into: 'b', failed: true }], snap),
    [{ kind: 'mergeEnded', id: 'c', into: 'b', failed: true }])
})

test('a duplicate pore gets its own room in a wide gap, and none where it would cover a cell', () => {
  const box = { w: 300, h: 200 }
  // Two cells 60px apart wall to wall: the pore halfway gets its full 8px, and the cells keep clear of it.
  const wide = foamPoreHits([{ x: 50, y: 100, r: 20 }, { x: 150, y: 100, r: 20 }], [{ x: 100, y: 100 }], box)
  assert.equal(wide.pores[0], 8)
  assert.ok(wide.cells.every((r, i) => r + 8 <= Math.abs([50, 150][i] - 100) + 1e-9))
  // Tight together (2px gap): no pore, and the cells keep exactly the hit circles they would have without it.
  const tight = [{ x: 50, y: 100, r: 20 }, { x: 92, y: 100, r: 20 }]
  const t = foamPoreHits(tight, [{ x: 71, y: 100 }], box)
  assert.equal(t.pores[0], 0)
  assert.deepEqual(t.cells, foamHitRadii(tight, box))
  // A third cell sits right where the pore would be: no pore over it.
  const third = foamPoreHits([{ x: 50, y: 100, r: 20 }, { x: 150, y: 100, r: 20 }, { x: 100, y: 104, r: 12 }], [{ x: 100, y: 100 }], box)
  assert.equal(third.pores[0], 0)
  // A cell whose outline bulges past its round size (reach) keeps the pore off that bulge too.
  const bulge = foamPoreHits([{ x: 50, y: 100, r: 20, reach: 45 }, { x: 150, y: 100, r: 20 }], [{ x: 100, y: 100 }], box)
  assert.equal(bulge.pores[0], 0)
})

test('a pore at the edge of fitting stays shown with a little less room, so it does not blink', () => {
  const box = { w: 300, h: 200 }, cells = [{ x: 50, y: 100, r: 20 }, { x: 110, y: 100, r: 20 }]
  // 20px wall to wall: the pore gets half of the 10px to each wall, 5px, just under the 5.5px a new pore needs to appear.
  const fresh = foamPoreHits(cells, [{ x: 80, y: 100 }], box)
  const shown = foamPoreHits(cells, [{ x: 80, y: 100, shown: true }], box)
  assert.equal(fresh.pores[0], 0)
  assert.ok(shown.pores[0] > 0 && shown.pores[0] < 5.5, String(shown.pores[0]))
})

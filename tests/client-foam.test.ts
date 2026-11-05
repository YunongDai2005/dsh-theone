import assert from 'node:assert/strict'
import { test } from 'node:test'
import { foamLabel, foamShortName } from '../src/client-foam.ts'
import { foamEventsFrom, modelFromBubbles, modelFromCatalog } from '../src/client-foam-host.ts'
import type { CatalogSnapshot } from '../src/catalog-types.ts'
import type { BubbleEvent, BubbleSnapshot, BubbleTopic, BubbleWorkItem } from '../src/bubble-types.ts'

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
    { ...meta, seq: 8, type: 'topic.merged', sourceId: 'c', targetId: 'a' },
  ]
  assert.deepEqual(foamEventsFrom(events, snap), [
    { kind: 'route', to: 'a', alternates: ['c'] },
    { kind: 'supplement', to: 'b' },
    { kind: 'create', to: 'c' },
    { kind: 'clarify', candidates: ['a', 'b'] },
    { kind: 'correct', from: 'a', to: 'b' },
    { kind: 'merged', id: 'c', into: 'a' },
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

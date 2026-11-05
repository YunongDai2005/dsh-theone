import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ContextStore } from '../src/store.ts'
import { projectBubbles } from '../src/bubble-projection.ts'
import type { BubbleWorkItem } from '../src/bubble-types.ts'

const scope = { gatewayKey: 'test', gatewayId: 'main' }
const work = (overrides: Partial<BubbleWorkItem> = {}): BubbleWorkItem => ({
  id: 'w1', gatewayId: 'main', primaryMessageId: 'm1', messageIds: ['m1'], batchId: 'batch', source: 'user',
  contextId: 'a', executionId: 'e1', lane: 'background', phase: 'running',
  delivery: { phase: 'waiting', shownSteps: 0, committedSteps: 0, commit: null },
  updatedAt: 20, stop: { allowed: false, reason: 'unsupported' }, ...overrides,
})
function setup() {
  const store = new ContextStore(':memory:')
  store.seed(['a', 'b', 'c'].map(id => ({ id, title: id, summary: 'private body', entities: [], keywords: [], lastState: '' })))
  store.mount('test', 'a')
  return store
}

test('mount, business lifecycle, concurrent work and delivery remain independent', () => {
  const store = setup()
  try {
    store.startTopicRun('m1', 'a', 'worker', 10)
    const view = projectBubbles(store, { scope, workItems: [work(), work({ id: 'w2', primaryMessageId: 'm2', messageIds: ['m2'], executionId: null, phase: 'queued' })], now: 30 })
    const a = view.topics.find(t => t.id === 'a')!
    assert.equal(a.current, true)
    assert.equal(a.lifecycle, 'active')
    assert.deepEqual(a.workItemIds, ['w1', 'w2'])
    assert.equal(a.capabilities.declareDone.allowed, false)
    assert.deepEqual(view.topics.find(t => t.id === 'b')!.usage, { completedCalls: 0, recentCalls: 0, lastUsedAt: null })
    assert.equal(a.project, null)
    assert.equal(a.topicRevision, null)
  } finally { store.close() }
})

test('successful background work is ready despite a stale running record, and aside does not replace current', () => {
  const store = setup()
  try {
    store.startTopicRun('m1', 'b', 'worker', 10)
    const view = projectBubbles(store, { scope, workItems: [work({ contextId: 'b', phase: 'succeeded', outcome: 'completed', temporary: { kind: 'model_aside', returnContextId: 'a' } })], now: 30 })
    assert.equal(view.topics.find(t => t.id === 'a')!.current, true)
    assert.equal(view.topics.find(t => t.id === 'b')!.current, false)
    assert.equal(view.workItems[0].phase, 'succeeded')
    assert.equal(view.workItems[0].delivery.phase, 'waiting')
    assert.deepEqual(view.topics.find(t => t.id === 'b')!.capabilities.declareDone, { allowed: false, reason: 'pending_delivery' })
  } finally { store.close() }
})

test('done declarations are historical, and live waits take priority', () => {
  const store = setup()
  try {
    store.startTopicRun('m1', 'a', 'worker', 10); store.endTopicRun('m1', 'completed', 15)
    store.declareTopic('a', 'done', 20)
    assert.equal(projectBubbles(store, { scope, now: 30 }).topics.find(t => t.id === 'a')!.effectiveDone, true)
    store.startTopicRun('m2', 'a', 'worker', 25)
    const view = projectBubbles(store, { scope, workItems: [work({ phase: 'waiting_user' })], now: 30 })
    const a = view.topics.find(t => t.id === 'a')!
    assert.equal(a.declaredDoneAt, 20)
    assert.equal(a.effectiveDone, false)
    assert.equal(a.lifecycle, 'waiting')
  } finally { store.close() }
})

test('unobserved persisted running work is recovering, never a fabricated live execution', () => {
  const store = setup()
  try {
    store.plan('m1', 'main', 'test', { action: 'KEEP', contextId: 'a', reason: 'test' })
    store.startTopicRun('m1', 'a', 'worker', 10)
    let view = projectBubbles(store, { scope, now: 30 })
    assert.equal(view.workItems[0].phase, 'recovering')
    assert.equal(view.workItems[0].executionId, null)
    assert.equal(view.workItems[0].delivery.phase, 'unknown')
    store.interruptTopicRuns(40)
    view = projectBubbles(store, { scope, now: 50 })
    assert.equal(view.workItems[0].phase, 'interrupted')
    assert.equal(view.workItems[0].delivery.phase, 'unknown')
  } finally { store.close() }
})

test('hidden endpoints reveal no titles or references; archived active targets stay visible', () => {
  const store = setup()
  try {
    store.replaceHidden([{ id: 'a', reason: 'archived' }, { id: 'b', reason: 'excluded' }, { id: 'c', reason: 'orphaned' }])
    store.setManualLink('a', 'b', 1)
    const view = projectBubbles(store, { scope, workItems: [work({ contextId: 'b' })], now: 30 })
    assert.deepEqual(view.topics.map(t => t.id), ['a'])
    assert.equal(view.workItems[0].contextId, null)
    assert.equal(view.workItems[0].targetUnavailable, true)
    assert.deepEqual(view.edges, [])
    assert.equal(JSON.stringify(view).includes('private body'), false)
  } finally { store.close() }
})

test('layout edges are bounded, preserve kept-apart and do not claim private isolation', () => {
  const store = setup()
  try {
    store.setManualLink('a', 'b', 1); store.setManualLink('b', 'c', -1); store.setPrivate('a', true)
    const view = projectBubbles(store, { scope, now: 30 })
    assert.deepEqual(view.edges.map(e => [e.a, e.b, e.relation, e.strength]), [['a', 'b', 'related', 1], ['b', 'c', 'kept_apart', 1]])
    assert.equal(view.topics.find(t => t.id === 'a')!.private, true)
  } finally { store.close() }
})

test('projection is read only, including links, and returned objects cannot mutate observations', () => {
  const store = setup()
  try {
    const original = work()
    const db = (store as unknown as { db: { prepare(sql: string): { get(): unknown } } }).db
    const before = db.prepare('SELECT total_changes() AS n').get()
    const view = projectBubbles(store, { scope, workItems: [original], now: 30 })
    view.workItems[0].messageIds.push('forged')
    assert.deepEqual(original.messageIds, ['m1'])
    assert.deepEqual(db.prepare('SELECT total_changes() AS n').get(), before)
  } finally { store.close() }
})

test('archived work stays visible when another gateway owns the pending delivery', () => {
  const store = setup()
  try {
    store.replaceHidden([{ id: 'b', reason: 'archived' }])
    const view = projectBubbles(store, { scope, doneCapabilities: new Map([['b', { allowed: false, reason: 'pending_delivery' }]]), now: 30 })
    assert.equal(view.topics.some(t => t.id === 'b'), true)
  } finally { store.close() }
})

for (const row of [
  { title: '想去日本旅游，帮我看看行程', entities: ['东京', '日本'], keywords: ['旅游', '行程'], label: '日本' },
  { title: 'Planning a TypeScript migration', entities: ['JavaScript', 'TypeScript'], keywords: ['migration'], label: 'TypeScript' },
  { title: '优化 Qwen 显存，记录 CUDA 参数', entities: ['CUDA', 'Qwen'], keywords: ['显存'], label: 'Qwen' },
  { title: '学习 AI绘画工作流', entities: ['AI绘画'], keywords: [], label: 'AI绘画' },
  { title: '一个没有关键词的话题', entities: [], keywords: [], label: null },
  { title: '没有短词', entities: ['甲', '这是特别长的话题名称', 'Internationalization'], keywords: ['12345', '🙂'], label: null },
  { title: '通用计划', entities: ['日本'], keywords: ['行程'], label: '日本' },
  { title: 'Qwen settings', entities: [' Qwen ', 'qwen'], keywords: ['Qwen'], label: 'Qwen' },
]) test('bubble label uses bounded existing terms: ' + row.title, () => {
  const store = new ContextStore(':memory:')
  try {
    store.seed([{ id: 'topic', summary: '', lastState: '', title: row.title, entities: row.entities, keywords: row.keywords }])
    const db = (store as any).db
    const before = db.prepare('SELECT total_changes() AS n').get()
    const label = () => projectBubbles(store, { scope }).topics[0].label
    assert.equal(label(), row.label)
    assert.equal(label(), row.label)
    assert.deepEqual(db.prepare('SELECT total_changes() AS n').get(), before)
  } finally { store.close() }
})

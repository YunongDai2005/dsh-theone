import assert from 'node:assert/strict'
import { test } from 'node:test'
import { foamLabel } from '../src/client-foam.ts'
import { modelFromCatalog } from '../src/client-foam-host.ts'
import type { CatalogSnapshot } from '../src/catalog-types.ts'

test('a cell shows its whole name or none of it, never a clipped name', () => {
  const names = ['猫粮', '日语', '跑鞋', '学吉他', '显卡选购', '周末书单', '换季衣物', '面试准备材料', '一个特别特别长的话题名字', 'Budget', 'Kubernetes upgrade']
  for (const name of names) for (let radius = 12; radius <= 34; radius += 1) {
    const { lines } = foamLabel(name, radius)
    assert.ok(lines.length === 0 || lines.join('') === name, `${name} at ${radius}: ${JSON.stringify(lines)}`)
    assert.ok(!lines.join('').includes('…'))
    assert.ok(lines.length <= 2)
  }
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

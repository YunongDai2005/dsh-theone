import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import { applicableNotices, NoticeBoard, versionMatches } from '../src/notices.ts'
import { harness } from './harness.ts'

const file = {
  notices: [
    { id: 'update', level: 'important', title: { zh: '请更新', en: 'Please update' }, body: '新版修复了更新问题', link: 'https://github.com/YunongDai2005/dsh-theone/releases', versions: '<0.3.16' },
    { id: 'launch', title: { zh: '发布了', en: 'Out now' }, body: { zh: '欢迎试用', en: 'Try it' }, link: 'javascript:alert(1)', until: '2099-01-01' },
    { id: 'expired', title: 'old', body: 'old', until: '2000-01-01' },
    { id: 'future', title: 'soon', body: 'soon', from: '2099-01-01' },
    { id: 'bad id!', title: 'x', body: 'x' },
    { id: 'empty', title: '', body: 'x' },
  ],
}

test('version ranges, dates and links are checked before a notice is shown', () => {
  assert.equal(versionMatches('<0.3.16', '0.3.13'), true)
  assert.equal(versionMatches('>=0.3.10 <0.3.16', '0.3.16'), false)
  assert.equal(versionMatches('0.3.12', '0.3.12'), true)
  assert.equal(versionMatches('*', '9.9.9'), true)
  assert.equal(versionMatches('latest', '0.3.12'), false)
  const old = applicableNotices(file, '0.3.13')
  assert.deepEqual(old.map(notice => notice.id), ['update', 'launch'])
  assert.equal(old[0].level, 'important')
  assert.deepEqual(old[0].body, { zh: '新版修复了更新问题', en: '新版修复了更新问题' })
  // Only https links are kept.
  assert.equal(old[1].link, undefined)
  assert.equal(old[1].level, 'info')
  assert.deepEqual(applicableNotices(file, '0.3.16').map(notice => notice.id), ['launch'])
  assert.deepEqual(applicableNotices('not json', '0.3.16'), [])
})

test('the notice file is read at most every three hours, and an unreachable one shows nothing', async () => {
  let time = Date.now(), reads = 0, fail = false
  const board = new NoticeBoard('0.3.13', 'https://example.test/notice.json', (async () => {
    reads++
    if (fail) throw new Error('offline')
    return new Response(JSON.stringify(file))
  }) as typeof fetch, () => time)
  assert.equal((await board.notices()).length, 2)
  await board.notices(); assert.equal(reads, 1)
  time += 4 * 3600000; fail = true
  // Offline: what was read before stays.
  assert.equal((await board.notices()).length, 2)
  const offline = new NoticeBoard('0.3.13', 'https://example.test/notice.json', (async () => { throw new Error('offline') }) as typeof fetch)
  assert.deepEqual(await offline.notices(), [])
})

test('closed notices stay closed, and the setting turns notices off', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-notices-'))
  const app = await harness(root)
  try {
    Object.defineProperty(app.ctx.theone, 'noticeBoard', { value: new NoticeBoard('0.3.13', 'https://example.test/n.json', (async () => new Response(JSON.stringify(file))) as typeof fetch) })
    const connection = new HostConnectionService(app.ctx, [], undefined as never)
    const handler = connection.createSharedFetchHandler('/api')
    await new Promise<void>(resolve => setImmediate(resolve))
    const read = async (init?: RequestInit) => (await (await handler.fetch(new Request('http://dsh.internal/api/theone/notices', init))).json()) as { notices: { id: string }[] }
    assert.deepEqual((await read()).notices.map(notice => notice.id), ['update', 'launch'])
    const closed = await read({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dismiss: 'update' }) })
    assert.deepEqual(closed.notices.map(notice => notice.id), ['launch'])
    const initial = await app.ctx.theone.settingsSnapshot()
    assert.equal(initial.values.notices, true)
    const saved = await handler.fetch(new Request('http://dsh.internal/api/theone/settings', { method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ values: { ...initial.savedValues, notices: false }, revision: initial.revision }) }))
    assert.equal(saved.status, 200)
    assert.deepEqual((await read()).notices, [])
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

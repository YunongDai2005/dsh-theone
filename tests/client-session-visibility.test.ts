import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SessionVisibility, type OwnedSessions } from '../src/client-session-visibility.ts'

const shown: OwnedSessions = { sessionIds: ['main', 'topic'], mainSessionIds: ['main'], hideTopicSessions: false }
const hidden: OwnedSessions = { ...shown, hideTopicSessions: true }

test('a late old response cannot hide topics again after a newer response showed them', async () => {
  const replies: ((value: OwnedSessions) => void)[] = []
  const updates: string[][] = []
  const visibility = new SessionVisibility(() => new Promise(resolve => replies.push(resolve)), () => updates.push(visibility.hiddenIds()))
  const old = visibility.refresh()
  const current = visibility.refresh()
  replies[1](shown); await current
  replies[0](hidden); await old
  assert.deepEqual(updates, [['main']])
  assert.deepEqual(visibility.hiddenIds(), ['main'])
})

test('only owned topic rows follow the switch; main chat remains behind its dedicated entry', async () => {
  let value = shown
  const visibility = new SessionVisibility(async () => value, () => {})
  await visibility.refresh()
  assert.deepEqual(visibility.hiddenIds('new-main'), ['main', 'new-main'])
  value = hidden
  await visibility.refresh()
  assert.deepEqual(visibility.hiddenIds('main'), ['main', 'topic'])
  assert.equal(visibility.hiddenIds().includes('ordinary'), false)
})

test('failed refresh preserves the last state, and disposal ignores an in-flight reply', async () => {
  let read = async () => hidden
  let changes = 0
  const visibility = new SessionVisibility(() => read(), () => { changes++ })
  await visibility.refresh()
  read = async () => { throw new Error('offline') }
  await visibility.refresh()
  assert.deepEqual(visibility.hiddenIds(), ['main', 'topic'])
  let reply!: (value: OwnedSessions) => void
  read = () => new Promise(resolve => { reply = resolve })
  const pending = visibility.refresh()
  visibility.dispose()
  reply(shown); await pending
  assert.equal(changes, 1)
})

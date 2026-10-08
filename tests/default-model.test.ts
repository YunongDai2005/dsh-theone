import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ContextStore } from '../src/store.ts'
import { harness } from './harness.ts'

test('main chat picking TheOne leaves the user’s default model as it was', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-default-model-'))
  const app = await harness(root)
  try {
    // DSH saves every session's model choice as the default; stand in for its profile write.
    let saved = { provider: 'deepseek', model: 'deepseek-v4' }
    const service = app.ctx.agentDefaultModel as unknown as { currentSelection(): typeof saved; saveSelection(next: typeof saved): Promise<void> }
    service.currentSelection = () => ({ ...saved })
    service.saveSelection = async next => { saved = { provider: next.provider, model: next.model } }

    app.ctx.theone.holdDefaultModel()
    await service.saveSelection({ provider: 'theone', model: 'gateway' }) // what DSH does for main chat
    await app.ctx.theone.restoreDefaultModel()
    assert.deepEqual(saved, { provider: 'deepseek', model: 'deepseek-v4' })

    // A default the user set to TheOne themselves is not changed.
    saved = { provider: 'theone', model: 'gateway' }
    app.ctx.theone.holdDefaultModel()
    await app.ctx.theone.restoreDefaultModel()
    assert.deepEqual(saved, { provider: 'theone', model: 'gateway' })
    // Nothing held, nothing restored.
    await app.ctx.theone.restoreDefaultModel()
    assert.deepEqual(saved, { provider: 'theone', model: 'gateway' })
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('one-time repairs run once', () => {
  const store = new ContextStore(':memory:')
  try {
    assert.equal(store.markOnce('default-model-restored'), true)
    assert.equal(store.markOnce('default-model-restored'), false)
  } finally { store.close() }
})

test('TheOne lists only the sessions it made: main chats and topic sessions, never the user’s own', () => {
  const store = new ContextStore(':memory:')
  try {
    store.seed([{ id: 'ctx_a', title: 'A', summary: 'A', entities: [], keywords: [], lastState: '' }])
    store.rememberGateway('default', 'main-chat')
    // An ordinary chat of the user's that picked TheOne as its model is routed, but stays theirs.
    store.plan('m1', 'users-own-chat', 'default', { action: 'MOUNT', contextId: 'ctx_a', reason: 'test' })
    const owned = store.ownedSessionIds()
    assert.ok(owned.includes('main-chat'))
    assert.ok(owned.includes(store.contexts()[0].workingSessionId))
    assert.ok(!owned.includes('users-own-chat'))
    assert.equal(owned.length, 2)
  } finally { store.close() }
})

test('off and on again: only TheOne’s own sessions go to the archive, and only those it put there come back', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-stow-'))
  const app = await harness(root)
  try {
    const theone = app.ctx.theone as unknown as {
      store: ContextStore
      stowOwnSessions(registry: unknown): Promise<void>
      unstowOwnSessions(registry: unknown): Promise<void>
    }
    const store = theone.store
    store.rememberGateway('default', 'main-chat')
    const topicSession = store.contexts()[0].workingSessionId
    // The user archived one of their own chats; TheOne's topic session happens to be out.
    const archived = new Set(['users-archived-chat'])
    const calls: string[] = []
    const registry = {
      get archivedSessionIds() { return [...archived] },
      async archiveSession(id: string) { calls.push(`archive ${id}`); archived.add(id) },
      async unarchiveSession(id: string) { calls.push(`unarchive ${id}`); archived.delete(id) },
    }
    await theone.stowOwnSessions(registry)
    assert.ok(archived.has('main-chat') && archived.has(topicSession))
    assert.ok(!calls.some(call => call.includes('users-archived-chat')))

    await theone.unstowOwnSessions(registry)
    // Main chat is back out; the topic session stays archived until it answers; the user's chat is untouched.
    assert.ok(!archived.has('main-chat'))
    assert.ok(archived.has(topicSession))
    assert.ok(archived.has('users-archived-chat'))
    assert.ok(!calls.includes('unarchive users-archived-chat'))
    assert.deepEqual(store.stowedSessionIds(), [])
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

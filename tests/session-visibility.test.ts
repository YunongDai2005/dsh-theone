import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { harness, ask, peered } from './harness.ts'
import type { EditableSettings } from '../src/settings-types.ts'
import Storage from '@deepseek-ai/dsh-storage'
import * as JsonStorage from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import { SessionId } from '@deepseek-ai/dsh-session'
import { randomUUID } from 'node:crypto'

const tick = () => new Promise<void>(resolve => setImmediate(resolve))

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'theone-visibility-race-'))
  const app = await harness(root, undefined, { theoneConfig: { hideTopicSessions: true } })
  const service = app.ctx.theone as unknown as {
    ownArchive: unknown
    stowWhenIdle(id: string, attempt?: number): void
    readyToRun(id: string): Promise<void>
    unstowOwnSessions(registry: unknown): Promise<void>
    applySettings(values: EditableSettings, descriptors: []): Promise<void>
  }
  const store = app.ctx.theone.store
  // The timing tests control only the archive boundary; settings and ownership are real.
  store.markOnce('owned-archive-tracking-v1')
  const id = store.contexts()[0].workingSessionId
  const archived = new Set<string>()
  let release!: () => void
  let gate: Promise<void> | undefined
  let reject = false
  const registry = {
    get archivedSessionIds() { return [...archived] },
    async archiveSession(id: string) {
      if (reject) throw new Error('session is busy')
      await gate
      archived.add(id)
    },
    async unarchiveSession(id: string) { archived.delete(id) },
  }
  service.ownArchive = registry
  const values = (await app.ctx.theone.settingsSnapshot()).savedValues
  return {
    app, store, service, id, archived,
    hold() { gate = new Promise<void>(resolve => { release = resolve }); return () => release() },
    reject() { reject = true },
    setHidden: (hideTopicSessions: boolean) => service.applySettings({ ...values, hideTopicSessions }, []),
    restore: () => service.unstowOwnSessions(registry),
    async close() { release?.(); await tick(); await app.close(); await rm(root, { recursive: true, force: true }) },
  }
}

test('rapid hide/show saves do not lose ownership of an archive still being written', async () => {
  const f = await fixture()
  try {
    const release = f.hold()
    f.service.stowWhenIdle(f.id)
    const show = f.setHidden(false)
    const hide = f.setHidden(true)
    await tick()
    release()
    await Promise.all([show, hide])
    await tick()
    await f.setHidden(false)
    assert.equal(f.archived.has(f.id), false, 'the final show must restore the topic')
    assert.equal(f.store.stowedSessionIds().includes(f.id), false)
  } finally { await f.close() }
})

test('starting a topic waits for an earlier archive and then unarchives it', async () => {
  const f = await fixture()
  try {
    const release = f.hold()
    f.service.stowWhenIdle(f.id)
    const ready = f.service.readyToRun(f.id)
    await tick()
    release()
    await ready
    await tick()
    assert.equal(f.archived.has(f.id), false, 'DSH must not receive a new turn in an archived session')
    assert.equal(f.store.stowedSessionIds().includes(f.id), false)
  } finally { await f.close() }
})

test('a rejected automatic archive cannot later undo a manual archive', async () => {
  const f = await fixture()
  try {
    f.reject()
    f.service.stowWhenIdle(f.id, 10)
    await tick()
    f.archived.add(f.id) // The user archives the topic later.
    await f.setHidden(false)
    assert.equal(f.archived.has(f.id), true)
    assert.equal(f.store.stowedSessionIds().includes(f.id), false)
  } finally { await f.close() }
})

test('a delayed startup session listing cannot touch the database after plugin shutdown', async () => {
  const f = await fixture()
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  f.app.ctx.sessionQuery.listSessions = async () => { await gate; return [] }
  try {
    const restore = f.restore()
    await tick()
    await f.app.close()
    release()
    await assert.doesNotReject(restore)
  } finally { release(); await f.close() }
})

test('real DSH preserves topic history through hiding, continued work and restart without changing manual archives', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-visibility-dsh-'))
  const setup = async () => {
    const app = await harness(root)
    await app.ctx.plugin(Storage)
    await app.ctx.plugin(JsonStorage, { root: join(root, 'workspace-store') })
    await app.ctx.plugin(StorageDomain, { backend: 'json' })
    await app.ctx.plugin(WorkspaceRegistry)
    const handler = peered(new HostConnectionService(app.ctx, [], undefined as never))
    await tick()
    const setHidden = async (hideTopicSessions: boolean) => {
      const snapshot = await app.ctx.theone.settingsSnapshot()
      const response = await handler.fetch(new Request('http://dsh.internal/api/theone/settings', {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ revision: snapshot.revision, values: { ...snapshot.savedValues, hideTopicSessions } }),
      }))
      assert.equal(response.status, 200)
    }
    const waitArchived = async (id: string) => {
      const deadline = Date.now() + 5000
      while (!app.ctx.workspaceRegistry.archivedSessionIds.includes(SessionId(id)) && Date.now() < deadline)
        await new Promise(resolve => setTimeout(resolve, 20))
      assert.ok(app.ctx.workspaceRegistry.archivedSessionIds.includes(SessionId(id)))
    }
    return { ...app, setHidden, waitArchived }
  }
  let app = await setup()
  try {
    const first = await ask(app.gateway, 'Qwen 后来怎么解决的？')
    assert.match(first.output, /ctx_qwen_9070xt/)
    const topic = app.ctx.theone.store.contexts().find(item => item.id === 'ctx_qwen_9070xt')!
    const id = SessionId(topic.workingSessionId)
    const ordinary = await app.ctx.agents.create({ sessionId: SessionId(randomUUID()), agentOptions: { provider: 'fixture', model: 'fixture' } })
    await app.ctx.workspaceRegistry.archiveSession(ordinary.agent.id)
    assert.equal(app.ctx.workspaceRegistry.archivedSessionIds.includes(id), false)
    await app.ctx.workspaceRegistry.pinSession(id)
    await app.setHidden(true)
    await app.setHidden(false)
    assert.ok(app.ctx.workspaceRegistry.pinnedSessionIds.includes(id), 'display settings must preserve the user pin')
    await app.ctx.workspaceRegistry.unpinSession(id)
    await app.setHidden(true)
    await app.waitArchived(id)
    const next = await ask(app.gateway, 'Qwen 继续')
    assert.match(next.output, /ctx_qwen_9070xt/)
    await app.waitArchived(id)
    await app.close()
    app = await setup()
    await app.waitArchived(id)
    await app.setHidden(false)
    assert.equal(app.ctx.workspaceRegistry.archivedSessionIds.includes(id), false)
    assert.ok(app.ctx.workspaceRegistry.archivedSessionIds.includes(ordinary.agent.id))
    const history = await app.ctx.sessionQuery.readSession(id)
    assert.ok(history.events.filter(event => event.type === 'assistant/message').length >= 2)
    // After showing it, the user can archive the topic explicitly; unrelated saves and restart respect that.
    await app.ctx.workspaceRegistry.archiveSession(id)
    await app.setHidden(false)
    assert.ok(app.ctx.workspaceRegistry.archivedSessionIds.includes(id))
    await app.close()
    app = await setup()
    assert.ok(app.ctx.workspaceRegistry.archivedSessionIds.includes(id))
    await app.ctx.workspaceRegistry.unarchiveSession(id)
    await app.ctx.workspaceRegistry.pinSession(id)
    await app.setHidden(true)
    await app.close()
    app = await setup()
    assert.ok(app.ctx.workspaceRegistry.pinnedSessionIds.includes(id), 'shutdown must preserve the user pin too')
    assert.equal(app.ctx.workspaceRegistry.archivedSessionIds.includes(id), false)
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

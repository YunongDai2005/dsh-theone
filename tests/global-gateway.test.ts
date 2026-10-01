import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import Storage from '@deepseek-ai/dsh-storage'
import * as JsonStorage from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import { SessionId } from '@deepseek-ai/dsh-session'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import { harness } from './harness.ts'

async function setup(root: string) {
  const app = await harness(root)
  await app.ctx.plugin(Storage)
  await app.ctx.plugin(JsonStorage, { root: join(root, 'workspace-store') })
  await app.ctx.plugin(StorageDomain, { backend: 'json' })
  await app.ctx.plugin(WorkspaceRegistry)
  const connection = new HostConnectionService(app.ctx, [], undefined as never)
  const handler = connection.createSharedFetchHandler('/api')
  await new Promise<void>(resolve => setImmediate(resolve))
  const prepare = (sessionId: string) => handler.fetch(new Request('http://dsh.internal/api/theone/gateway/prepare', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId }),
  }))
  return { ...app, handler, prepare }
}

test('global Gateway migration detaches only its own Session, persists, and unarchives on reopen', async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-global-gateway-'))
  let app = await setup(root)
  const id = SessionId(randomUUID()), ordinaryId = SessionId(randomUUID())
  let workspaceId: ReturnType<typeof app.ctx.workspaceRegistry.list>[number]['id']
  try {
    const project = join(root, 'project'); await mkdir(project)
    const workspace = await app.ctx.workspaceRegistry.create(project)
    workspaceId = workspace.id
    const legacy = await app.ctx.agents.create({ sessionId: id, meta: { cwd: await realpath(project) }, agentOptions: { provider: 'theone', model: 'gateway' } })
    legacy.agent.session.append('session/title', { title: 'TheOne · 主聊天', messageSeqs: [], source: { kind: 'user' } })
    const before = legacy.agent.session.snapshotEvents()
    await workspace.attachSession(id)
    const ordinary = await app.ctx.agents.create({ sessionId: ordinaryId, meta: { cwd: await realpath(project) }, agentOptions: { provider: 'fixture', model: 'fixture' } })
    ordinary.agent.session.append('session/title', { title: '普通会话', messageSeqs: [], source: { kind: 'user' } })
    await workspace.attachSession(ordinaryId)
    assert.equal((await app.prepare(ordinaryId)).status, 400)
    assert.ok(workspace.sessionIds.includes(ordinaryId))
    assert.equal((await app.prepare('missing')).status, 400)
    assert.equal((await app.prepare('../bad')).status, 400)
    assert.equal((await app.prepare(id)).status, 200)
    assert.equal(workspace.sessionIds.includes(id), false)
    assert.ok(workspace.sessionIds.includes(ordinaryId))
    assert.deepEqual(legacy.agent.session.snapshotEvents(), before)
    assert.ok(app.ctx.theone.store.isGateway(id))
    // This is registry-global archive recovery, not a fake flag on the plugin.
    await app.ctx.workspaceRegistry.archiveSession(id)
    assert.ok(app.ctx.workspaceRegistry.archivedSessionIds.includes(id))
    await app.prepare(id)
    assert.equal(app.ctx.workspaceRegistry.archivedSessionIds.includes(id), false)
    const directory = await app.handler.fetch(new Request('http://dsh.internal/api/theone/gateway'))
    assert.equal(directory.status, 200)
    const { cwd } = await directory.json()
    assert.equal(cwd, join(root, 'gateway'))
    const freshId = SessionId(randomUUID())
    const fresh = await app.ctx.agents.create({ sessionId: freshId, meta: { cwd }, agentOptions: { provider: 'theone', model: 'gateway' } })
    fresh.agent.session.append('session/title', { title: 'TheOne · Main chat', messageSeqs: [], source: { kind: 'user' } })
    assert.equal((await app.prepare(freshId)).status, 200)
    assert.ok(app.ctx.workspaceRegistry.list().every(w => !w.sessionIds.includes(freshId)))
    await app.close()
    assert.equal((await app.prepare(id)).status, 404)
    app = await setup(root)
    assert.equal(app.ctx.workspaceRegistry.get(workspaceId!)?.sessionIds.includes(id), false)
    assert.ok(app.ctx.workspaceRegistry.get(workspaceId!)?.sessionIds.includes(ordinaryId))
    assert.equal((await app.prepare(id)).status, 200)
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

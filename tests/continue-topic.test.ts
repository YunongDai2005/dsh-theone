import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Storage from '@deepseek-ai/dsh-storage'
import * as JsonStorage from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { harness, peered, ask } from './harness.ts'

/** What main chat said after an offset: its notes, one per turn. */
function said(agent: Agent, offset: number) {
  return agent.session.snapshotEvents().slice(offset).flatMap(event => event.type === 'assistant/message'
    ? [event.data.message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('')] : [])
}

test('"Continue chatting" on another topic says in main chat which topic comes next', async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-continue-'))
  const app = await harness(root)
  try {
    await app.ctx.plugin(Storage)
    await app.ctx.plugin(JsonStorage, { root: join(root, 'workspace-store') })
    await app.ctx.plugin(StorageDomain, { backend: 'json' })
    await app.ctx.plugin(WorkspaceRegistry)
    const handler = peered(new HostConnectionService(app.ctx, [], undefined as never))
    await new Promise<void>(resolve => setImmediate(resolve))
    const post = (path: string, body: unknown) => handler.fetch(new Request(`http://dsh.internal/api/theone/${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))
    // Continue chatting = mount, then open main chat (which prepares it).
    const continueTopic = async (contextId: string) => {
      assert.equal((await post('context/mount', { contextId })).status, 200)
      assert.equal((await post('gateway/prepare', { sessionId: app.gateway.id })).status, 200)
      await app.gateway.whenIdle()
    }
    app.gateway.session.append('session/title', { title: 'TheOne · 主聊天', messageSeqs: [], source: { kind: 'user' } })
    await ask(app.gateway, 'Qwen 的显存设置')
    const first = app.ctx.theone.store.current('test-gateway')!
    const other = app.ctx.theone.store.contexts().find(context => context.id !== first)!
    let offset = app.gateway.session.snapshotEvents().length
    await continueTopic(other.id)
    const notes = said(app.gateway, offset)
    assert.equal(notes.length, 1)
    assert.ok(notes[0].startsWith(`接下来继续「${other.title}」`), notes[0])
    assert.ok(!notes[0].includes('等待首次执行'), 'a placeholder is not where a topic left off')
    assert.ok(!notes[0].includes('。。'), notes[0])
    // Opening main chat again, or continuing the topic already in use, adds nothing.
    offset = app.gateway.session.snapshotEvents().length
    assert.equal((await post('gateway/prepare', { sessionId: app.gateway.id })).status, 200)
    await continueTopic(other.id)
    assert.deepEqual(said(app.gateway, offset), [])
    // And the next message goes to it.
    await ask(app.gateway, '继续')
    assert.equal(app.ctx.theone.store.current('test-gateway'), other.id)
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

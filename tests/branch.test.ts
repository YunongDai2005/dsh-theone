import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionId } from '@deepseek-ai/dsh-session'
import { harness, ask } from './harness.ts'

test('branching at a reply keeps the topic up to that reply, even when the same words were sent before', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-branch-'))
  const app = await harness(root)
  try {
    const first = await ask(app.gateway, 'Qwen 那个')
    const second = await ask(app.gateway, 'Qwen 那个')
    const reply = second.events.findLast(event => event.type === 'assistant/message')!
    const { contextId } = await app.ctx.theone.branch(app.gateway.id, reply.seq)
    const branch = app.ctx.theone.store.contexts().find(context => context.id === contextId)!
    const log = await app.ctx.sessionQuery.readSession(SessionId(branch.workingSessionId))
    const asked = log.events.filter(event => event.type === 'user/message' && event.data.source.kind === 'user')
    assert.equal(asked.length, 2)
    // And at the first reply, only the first turn.
    const early = await app.ctx.theone.branch(app.gateway.id, first.events.findLast(event => event.type === 'assistant/message')!.seq)
    const earlyLog = await app.ctx.sessionQuery.readSession(SessionId(app.ctx.theone.store.contexts().find(context => context.id === early.contextId)!.workingSessionId))
    assert.equal(earlyLog.events.filter(event => event.type === 'user/message' && event.data.source.kind === 'user').length, 1)
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

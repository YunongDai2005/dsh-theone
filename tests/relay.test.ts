import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { harness, ask, textResponse, FixtureModel } from './harness.ts'

const replies = (agent: Agent) => agent.session.snapshotEvents().flatMap(event => event.type === 'assistant/message'
  ? [event.data.message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('')] : []).filter(Boolean)
const notices = (agent: Agent) => agent.session.snapshotEvents().flatMap(event => event.type === 'user/message' && (event.data.source.kind as string) === 'subagent-settled'
  ? [event.data.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('')] : [])

async function until(condition: () => boolean, ms = 5000) {
  const end = Date.now() + ms
  while (!condition()) { if (Date.now() > end) throw new Error('timed out'); await new Promise(resolve => setTimeout(resolve, 10)) }
}

test('a topic that carries on by itself (a subagent reporting back) is shown in main chat', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-relay-'))
  const model = new FixtureModel()
  const app = await harness(root, model)
  let worker: Agent | undefined
  model.behavior = async function* (options) {
    worker = app.ctx.agents.get(SessionId(options.sessionId!))
    const last = options.messages.at(-1)
    const woken = last?.role === 'user' && 'source' in last && (last.source?.kind as string) === 'subagent-settled'
    yield* textResponse(woken ? '子代理的结果：3 个文件' : '已经派了一个子代理去查')
  }
  try {
    await ask(app.gateway, 'Qwen 那个，派个子代理查一下')
    assert.deepEqual(replies(app.gateway), ['已经派了一个子代理去查'])
    // What DSH does when the subagent finishes: the topic, idle by now, gets a notice and carries on.
    worker!.followup(createUserMessage({ source: { kind: 'subagent-settled', form: 'notice', summary: 'done', senderSessionId: 'child' } as unknown as UserMessage['source'],
      content: [{ type: 'text', text: 'Subagent finished.' }] }))
    await until(() => replies(app.gateway).length === 2 && app.gateway.status === 'idle')
    assert.deepEqual(replies(app.gateway), ['已经派了一个子代理去查', '子代理的结果：3 个文件'])
    assert.equal(notices(app.gateway).length, 1)
    // The same notice the topic got, so main chat shows DSH's own "subtask status updated" card.
    assert.equal(notices(app.gateway)[0], 'Subagent finished.')
    // Main chat is free again, and the next message routes as usual.
    assert.equal((await ask(app.gateway, 'Qwen 下一步呢')).end?.data.reason.kind, 'completed')
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('a topic\'s notice still queued in main chat after a restart is shown, not treated as an error', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-relay-restart-'))
  const app = await harness(root)
  try {
    // What a restart leaves: the notice in main chat's queue, with the work behind it gone.
    app.gateway.followup(createUserMessage({ source: { kind: 'subagent-settled', form: 'notice', summary: 'done', senderSessionId: 'child' } as unknown as UserMessage['source'],
      content: [{ type: 'text', text: 'Subagent finished.' }] }))
    await app.gateway.whenIdle()
    const end = app.gateway.session.snapshotEvents().findLast(event => event.type === 'turn/end')
    assert.equal(end?.type === 'turn/end' ? end.data.reason.kind : undefined, 'completed')
    assert.deepEqual(replies(app.gateway), ['Subagent finished.'])
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ApprovalOutcome, ApprovalRequestEvent } from '@deepseek-ai/dsh-user-approval/types'
import { harness, ask, FixtureModel, textResponse } from './harness.ts'

/** A topic that edits a file on its first step, with an approval service answering `answer`. */
async function editing(name: string, answer: ApprovalOutcome) {
  const root = await mkdtemp(join(tmpdir(), `theone-targets-${name}-`))
  const model = new FixtureModel()
  model.behavior = async function* (options) {
    // Tool results of this turn only (after the latest message from the user).
    const lastUser = options.messages.findLastIndex(message => message.role === 'user' && 'source' in message && message.source?.kind === 'user')
    const results = options.messages.slice(lastUser + 1).filter(message => message.role === 'tool')
    if (results.length < 2) {
      const id = ToolCallId(`edit-${results.length}`)
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'edit', arguments: JSON.stringify({ file_path: 'notes.md' }) } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    } else yield* textResponse('改好了')
  }
  const app = await harness(root, model)
  const asked: ApprovalRequestEvent[] = []
  app.ctx.provide('approval')
  app.ctx.set('approval', { request: async (request: ApprovalRequestEvent) => { asked.push(request); return answer } } as never)
  let edits = 0
  app.ctx.tools.register(defineTool({ name: 'edit', description: 'Edit a file', parameters: { file_path: { type: 'string', required: true } },
    output: { schema: { type: 'string' }, render: (_args, value: string) => [{ type: 'text', text: value }] }, execute: async () => { edits++; return 'edited' } }))
  return { app, asked, edits: () => edits, close: async () => { await app.close(); await rm(root, { recursive: true, force: true }) } }
}

test('when routing hesitated, a topic asks once before changing anything; confirmed, it carries on without asking again', { timeout: 30000 }, async () => {
  const t = await editing('confirm', 'allowed-once')
  try {
    // Two topics named: the first does the work, the other is what it may be about.
    const result = await ask(t.app.gateway, 'Qwen 和论文的进度整理到笔记里')
    assert.equal(result.output, '改好了')
    assert.equal(t.asked.length, 1)
    assert.match(String(t.asked[0].displayReason?.zh), /放在了「Qwen \/ RX 9070 XT」，但也可能是「Video Attention Thesis」的事/)
    assert.equal(t.asked[0].agent, t.app.gateway, 'asked in main chat')
    assert.equal(t.edits(), 2)
  } finally { await t.close() }
})

test('declined, the change is not made; a confident route changes things without asking', { timeout: 30000 }, async () => {
  const t = await editing('decline', 'rejected')
  try {
    await ask(t.app.gateway, 'Qwen 和论文的进度整理到笔记里')
    assert.equal(t.edits(), 0)
    assert.equal(t.asked.length, 2, 'each attempted change is checked until one is confirmed')
    t.asked.length = 0
    await ask(t.app.gateway, 'Qwen 的笔记整理一下')
    assert.equal(t.asked.length, 0)
    assert.equal(t.edits(), 2)
  } finally { await t.close() }
})

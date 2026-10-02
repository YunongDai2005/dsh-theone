import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import UserApproval from '@deepseek-ai/dsh-user-approval'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { harness, ask, textResponse } from './harness.ts'

test('a Worker tool approval is asked in the main chat and its answer reaches the Worker', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-approval-'))
  const app = await harness(root)
  const asked: { agent: string; toolName: string; display?: string }[] = []
  let outcome: string | undefined
  try {
    await app.ctx.plugin(UserApproval, { policy: 'ask' })
    // Stands in for the browser answerer, which only answers for the session it shows.
    app.ctx.on('approval/request', async (request, next) => {
      if (request.agent.id !== app.gateway.id) return next()
      asked.push({ agent: request.agent.id, toolName: request.toolName, display: request.displayReason?.zh })
      return 'allowed-once'
    })
    app.ctx.tools.register(defineTool({ name: 'guarded_write', description: 'Synthetic guarded tool', parameters: { path: { type: 'string', required: true } },
      output: { schema: { type: 'string' }, render: (_args, value: string) => [{ type: 'text', text: value }] },
      execute: async (_args, exec) => {
        outcome = await app.ctx.approval.request({ agent: exec.agent!, toolName: 'guarded_write', callId: exec.callId, reason: 'write outside workspace', signal: exec.signal })
        return outcome
      } }))
    let calls = 0
    app.model.behavior = async function* () {
      if (calls++ === 0) {
        const id = ToolCallId('guarded-call')
        yield { type: 'block-start', index: 0, blockType: 'tool-call' }
        yield { type: 'tool-call-delta', index: 0, id, name: 'guarded_write', argumentsDelta: '{"path":"/etc/hosts"}' }
        yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'guarded_write', arguments: '{"path":"/etc/hosts"}' } }
        yield { type: 'finish', reason: { kind: 'tool-calls' } }
      } else yield* textResponse('已写入')
    }
    const result = await ask(app.gateway, 'Qwen 那个')
    assert.equal(result.output, '已写入')
    assert.equal(outcome, 'allowed-once')
    assert.equal(asked.length, 1)
    assert.equal(asked[0].toolName, 'guarded_write')
    assert.match(asked[0].display ?? '', /guarded_write \{"path":"\/etc\/hosts"\}/)
    assert.ok(result.events.some(event => event.type === 'approval/decided'))
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

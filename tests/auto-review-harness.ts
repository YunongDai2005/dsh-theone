import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ToolCallId, type GenerateOptions } from '@deepseek-ai/dsh-llm'
import PermissionPresets from '@deepseek-ai/dsh-permission-presets'
import SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy'
import Approval from '@deepseek-ai/dsh-user-approval'
import * as AutoReview from '@deepseek-ai/dsh-experimental-auto-review'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { harness, textResponse } from './harness.ts'

export async function setupAutoReview() {
  const root = await mkdtemp(join(tmpdir(), 'theone-auto-review-'))
  const app = await harness(root, undefined, { cwd: root })
  await app.ctx.plugin(SandboxPolicy, { mode: 'workspace-write', workspaceRoot: root })
  await app.ctx.plugin(Approval, { policy: 'ask' })
  app.ctx.provide('shell', { sandboxMode: 'workspace-write' } as never)
  await app.ctx.plugin(Object.assign((ctx: typeof app.ctx) => { new PermissionPresets(ctx, {
    presets: {
      'workspace-write': { sandbox: 'workspace-write', approval: 'ask' },
      'danger-full-access': { sandbox: 'danger-full-access', approval: 'never' },
    },
    defaultPreset: { get: () => 'workspace-write' } as never,
  }) }, { inject: PermissionPresets.inject }))
  // Mount after TheOne, as a user enabling Auto after startup does.
  const autoPlugin = await app.ctx.plugin(AutoReview)
  let bodies = 0
  app.ctx.on('agent/created', ({ agent }) => {
    agent.ctx.tools.register(defineTool({ name: 'worker_probe', description: 'Read a synthetic test value', parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value: string) => [{ type: 'text', text: value }] },
      execute: async () => { bodies++; return 'PROBE_EXECUTED' },
    }))
    return undefined
  })
  const reviews: GenerateOptions[] = []
  const replies = new Set<string>()
  let requireSession = true
  let verdict = '{"risk":"low","decision":"allow"}'
  app.model.behavior = async function* (options) {
    if (typeof options.system === 'string' && options.system.startsWith('REVIEW_POLICY\n')) {
      reviews.push(options)
      if (requireSession && !options.sessionId) {
        yield { type: 'finish', reason: { kind: 'error', failure: { code: 'INVALID_REQUEST', message: 'MissingSessionID: Request is missing x-opencode-session' } } }
      } else yield* textResponse(verdict)
      return
    }
    const key = options.sessionId!
    if (!replies.has(key)) {
      replies.add(key)
      const id = ToolCallId(randomUUID())
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name: 'worker_probe', argumentsDelta: '{}' }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'worker_probe', arguments: '{}' } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    } else {
      const results = options.messages.filter(message => message.role === 'tool')
      yield* textResponse(JSON.stringify(results))
    }
  }
  app.ctx.permissionPresets.set(app.gateway.session, 'auto')
  return { ...app, autoPlugin, root, reviews, bodies: () => bodies,
    repeat: () => replies.clear(),
    requireSession: (value: boolean) => { requireSession = value },
    verdict: (value: string) => { verdict = value },
    close: async () => { await app.close(); await rm(root, { recursive: true, force: true }) },
  }
}

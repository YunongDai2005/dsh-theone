import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionId } from '@deepseek-ai/dsh-session'
import PermissionPresets from '@deepseek-ai/dsh-permission-presets'
import SandboxPolicy, { setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
import Approval, { setApprovalPolicy } from '@deepseek-ai/dsh-user-approval'
import { harness, ask, textResponse } from './harness.ts'

test('custom permissions reach new and reused topics, including permission reductions', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-custom-permissions-'))
  const app = await harness(root)
  try {
    await app.ctx.plugin(SandboxPolicy, { mode: 'workspace-write', workspaceRoot: root })
    await app.ctx.plugin(Approval, { policy: 'ask' })
    // No shell process is needed here: use the real permission, sandbox and approval
    // services, with only the executor's default capability and setting getter supplied.
    app.ctx.provide('shell', { sandboxMode: 'workspace-write' } as never)
    await app.ctx.plugin(Object.assign((ctx: typeof app.ctx) => { new PermissionPresets(ctx, {
      presets: {
        'workspace-write': { sandbox: 'workspace-write', approval: 'ask' },
        'danger-full-access': { sandbox: 'danger-full-access', approval: 'never' },
      },
      defaultPreset: { get: () => 'workspace-write' } as never,
    }) }, { inject: PermissionPresets.inject }))
    app.model.behavior = async function* (options) {
      const worker = app.ctx.agents.get(SessionId(options.sessionId!))!
      const mode = app.ctx.sandboxPolicy.resolve({ session: worker.session }).mode
      const policy = app.ctx.approval.overrideOf(worker.session) ?? app.ctx.approval.config.policy
      yield* textResponse(`${mode}/${policy}`)
    }
    const main = app.gateway.session
    setSandboxMode(main, 'danger-full-access')
    setApprovalPolicy(main, 'ask')
    assert.equal(app.ctx.permissionPresets.current(main), 'custom')
    assert.equal((await ask(app.gateway, 'Qwen 那个')).output, 'danger-full-access/ask')
    const topic = app.ctx.theone.store.contexts().find(c => c.id === 'ctx_qwen_9070xt')!
    const worker = app.ctx.agents.get(SessionId(topic.workingSessionId))!
    const knobs = () => worker.session.snapshotEvents().filter(e => e.type === 'sandbox/mode' || e.type === 'approval/policy').length
    const before = knobs()
    assert.equal((await ask(app.gateway, '继续')).output, 'danger-full-access/ask')
    assert.equal(knobs(), before, 'unchanged permissions should not append duplicate overrides')

    app.ctx.permissionPresets.set(main, 'danger-full-access')
    assert.equal((await ask(app.gateway, '继续')).output, 'danger-full-access/never')
    setApprovalPolicy(main, 'ask')
    assert.equal((await ask(app.gateway, '继续')).output, 'danger-full-access/ask')

    setSandboxMode(main, 'read-only')
    setApprovalPolicy(main, 'never')
    assert.equal(app.ctx.permissionPresets.current(main), 'custom')
    assert.equal((await ask(app.gateway, '继续')).output, 'read-only/never')
    app.ctx.permissionPresets.set(main, 'workspace-write')
    assert.equal((await ask(app.gateway, '继续')).output, 'workspace-write/ask')
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { SessionId } from '@deepseek-ai/dsh-session'
import { setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
import * as AutoReview from '@deepseek-ai/dsh-experimental-auto-review'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import { modelJson } from '../src/model-json.ts'
import { DshRouter } from '../src/llm-router.ts'
import { setupAutoReview as setup } from './auto-review-harness.ts'
import { ask, textResponse } from './harness.ts'

test('a reused Auto topic leaves Auto when main changes to matching custom knobs', async () => {
  const app = await setup()
  try {
    await ask(app.gateway, 'Qwen 那个')
    app.ctx.permissionPresets.set(app.gateway.session, 'workspace-write')
    setSandboxMode(app.gateway.session, 'danger-full-access')
    app.repeat()
    await ask(app.gateway, '继续')
    const topic = app.ctx.theone.store.contexts().find(c => c.id === 'ctx_qwen_9070xt')!
    const worker = app.ctx.agents.get(SessionId(topic.workingSessionId))!
    assert.equal(app.ctx.permissionPresets.current(app.gateway.session), 'custom')
    assert.equal(app.ctx.permissionPresets.current(worker.session), 'custom')
    assert.equal(app.reviews.length, 1)
    assert.equal(app.bodies(), 2)
    assert.ok(worker.session.snapshotEvents().every(e => e.type !== 'permission/preset' || e.data.preset !== 'custom'))
  } finally { await app.close() }
})

for (const during of ['model', 'review'] as const) {
  test(`tightening main permissions during ${during} prevents the next guarded tool body`, async () => {
    const app = await setup()
    try {
      if (during === 'model') app.ctx.permissionPresets.set(app.gateway.session, 'danger-full-access')
      // Synthetic write guard, reading the real sandbox-policy service immediately
      // before execution. No filesystem write or shell mock grants the permission.
      app.ctx.tools.guard(exec => exec.name === 'worker_probe' && exec.agent !== app.gateway
        && app.ctx.sandboxPolicy.resolve({ session: exec.agent!.session }).mode === 'read-only' ? 'read-only write denied' : undefined)
      const original = app.model.behavior!
      let changed = false
      app.model.behavior = async function* (options) {
        const review = typeof options.system === 'string' && options.system.startsWith('REVIEW_POLICY\n')
        if (!changed && (during === 'review' ? review : options.sessionId)) {
          changed = true
          setSandboxMode(app.gateway.session, 'read-only')
          const worker = app.ctx.agents.get(SessionId(options.sessionId!))!
          assert.equal(app.ctx.sandboxPolicy.resolve({ session: worker.session }).mode, 'read-only')
        }
        yield* original(options)
      }
      const result = await ask(app.gateway, 'Qwen 那个')
      assert.ok(changed)
      assert.equal(app.bodies(), 0)
      assert.match(result.output, /read-only write denied/)
    } finally { await app.close() }
  })
}

test('nested delegated children use their own review identity, unrelated lineage does not', async () => {
  const app = await setup()
  try {
    await ask(app.gateway, 'Qwen 那个')
    const topic = app.ctx.theone.store.contexts().find(c => c.id === 'ctx_qwen_9070xt')!
    let parent = app.ctx.agents.get(SessionId(topic.workingSessionId))!
    for (let depth = 0; depth < 2; depth++) {
      const child = (await parent.ctx.agents.create({ sessionId: SessionId(randomUUID()), parentAgent: parent,
        agentOptions: { provider: 'fixture', model: 'fixture' }, meta: { cwd: app.root, parentSession: parent.id } })).agent
      assert.ok(app.ctx.agents.isOwnedBy(child.id, parent))
      app.ctx.permissionPresets.set(child.session, 'auto')
      const result = await ask(child, 'Run the probe')
      assert.equal(app.reviews.at(-1)?.sessionId, child.id)
      assert.match(result.output, /PROBE_EXECUTED/)
      parent = child
    }
    // Persisted ancestry alone must not claim an unrelated runtime root.
    const other = (await app.ctx.agents.create({ sessionId: SessionId(randomUUID()),
      agentOptions: { provider: 'fixture', model: 'fixture' }, meta: { cwd: app.root, parentSession: parent.id } })).agent
    app.ctx.permissionPresets.set(other.session, 'auto')
    assert.match((await ask(other, 'Run the probe')).output, /MissingSessionID/)
    assert.equal(app.bodies(), 3)
  } finally { await app.close() }
})

test('loading Auto during a model response preserves review and mirror ordering', async () => {
  const app = await setup()
  try {
    const original = app.model.behavior!
    let reloaded = false
    app.model.behavior = async function* (options) {
      if (!reloaded && options.sessionId) {
        reloaded = true
        await app.autoPlugin.dispose()
        await app.ctx.plugin(AutoReview)
        app.ctx.permissionPresets.set(app.gateway.session, 'auto')
        app.ctx.permissionPresets.set(app.ctx.agents.get(SessionId(options.sessionId))!.session, 'auto')
      }
      yield* original(options)
    }
    const result = await ask(app.gateway, 'Qwen 那个')
    assert.equal(app.bodies(), 1)
    assert.equal(app.reviews.length, 1)
    assert.equal(result.events.filter(e => e.type === 'tool/result' && e.data.message.isError).length, 0)
  } finally { await app.close() }
})

test('routing and auxiliary JSON requests carry explicit or isolated transport identities', async () => {
  const app = await setup()
  try {
    const captured: GenerateOptions[] = []
    app.model.behavior = async function* (options) {
      captured.push(options)
      assert.ok(options.sessionId)
      yield* textResponse(JSON.stringify({ action: 'CREATE', title: '插件市场', reason: 'new task' }))
    }
    const router = new DshRouter(app.ctx.llm, () => ({ provider: 'fixture', model: 'fixture' }))
    const owned = app.gateway.id
    await router.decide({ text: '安装插件市场', contexts: [] }, undefined, owned)
    await modelJson(app.ctx.llm, { provider: 'fixture', model: 'fixture' }, 'Synthetic catalog analysis', {}, undefined, { sessionId: owned })
    await router.decide({ text: '安装插件市场', contexts: [] })
    await modelJson(app.ctx.llm, { provider: 'fixture', model: 'fixture' }, 'Synthetic catalog analysis', {})
    assert.deepEqual(captured.slice(0, 2).map(options => options.sessionId), [owned, owned])
    assert.equal(new Set(captured.map(options => options.sessionId)).size, 3)
    assert.ok(captured.every(options => !JSON.stringify(options.messages).includes(options.sessionId!)), 'transport identity stays out of prompt text')
  } finally { await app.close() }
})

test('cancelling a pending review stops execution and the next turn recovers', async () => {
  const app = await setup()
  try {
    const original = app.model.behavior!
    const entered = Promise.withResolvers<void>()
    app.model.behavior = async function* (options) {
      if (typeof options.system === 'string' && options.system.startsWith('REVIEW_POLICY\n')) {
        entered.resolve()
        await new Promise<void>(resolve => options.signal!.addEventListener('abort', () => resolve(), { once: true }))
        options.signal!.throwIfAborted()
      }
      yield* original(options)
    }
    const turn = ask(app.gateway, 'Qwen 那个')
    await entered.promise
    app.gateway.cancel({ kind: 'user' })
    await turn
    assert.equal(app.bodies(), 0)
    app.model.behavior = original
    app.repeat()
    assert.match((await ask(app.gateway, '继续')).output, /PROBE_EXECUTED/)
    assert.equal(app.bodies(), 1)
  } finally { await app.close() }
})

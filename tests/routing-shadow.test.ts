import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ask, harness } from './harness.ts'

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'theone-shadow-'))
  const app = await harness(root, undefined, { theoneConfig: { routeNotice: 'all' } })
  const shadow = (app.ctx.theone as any).shadow
  return { root, app, shadow, close: async () => { await app.close(); await rm(root, { recursive: true, force: true }) } }
}
const visible = (messageId: string, seq: number, topicId: string, source = 'user', extra = {}) =>
  ({ messageId, sessionId: 'main', seq, topicId, source, ...extra })

test('main-chat visible messages retain their identity, topic, source and display order', async () => {
  const f = await setup()
  try {
    assert.ok(f.shadow, 'the product must attach the persistent observation log')
    const result = await ask(f.app.gateway, 'Qwen 那个')
    const messages = f.shadow.snapshot('test-gateway').messages
    const user = messages.find((m: any) => m.messageId === result.input.id)
    assert.equal(user.topicId, 'ctx_qwen_9070xt')
    assert.equal(user.source, 'user')
    const notice = result.events.find(event => event.type === 'user/message' && event.data.source.kind === 'theone-route')
    assert.ok(notice?.type === 'user/message')
    assert.equal(messages.find((m: any) => m.messageId === notice.data.id).topicId, user.topicId)
    const reply = messages.find((m: any) => m.source === 'foreground')
    assert.equal(reply.topicId, user.topicId)
    assert.equal(reply.replyTo, user.messageId)
    assert.equal(f.shadow.snapshot('test-gateway').focus.messageId, reply.messageId)
    assert.ok(reply.displayOrder[1] > user.displayOrder[1])
    assert.equal(new Set(messages.map((m: any) => m.messageId)).size, messages.length)
  } finally { await f.close() }
})

test('background B completion and its displayed notice cannot take foreground focus from A', async () => {
  const f = await setup()
  try {
    assert.ok(f.shadow)
    f.shadow.record('g', visible('a', 1, 'A'))
    f.shadow.record('g', visible('b-complete', 2, 'B', 'background', { visible: false }))
    f.shadow.record('g', visible('b-notice', 3, 'B', 'background'))
    assert.equal(f.shadow.snapshot('g').focus.topicId, 'A')
    assert.equal(f.shadow.snapshot('g').background.length, 1)
    assert.equal(f.shadow.snapshot('g').messages.at(-1).source, 'background')
  } finally { await f.close() }
})

test('two pending questions and an approval keep independent topic owners', async () => {
  const f = await setup()
  try {
    assert.ok(f.shadow)
    f.shadow.record('g', visible('a', 1, 'A'))
    const a = f.shadow.openPending('g', { topicId: 'A', kind: 'question', messageId: 'a', basis: 'host-request' })
    const b = f.shadow.openPending('g', { topicId: 'B', kind: 'question', messageId: 'b', basis: 'host-request' })
    f.shadow.openPending('g', { topicId: 'B', kind: 'approval', messageId: 'b', basis: 'host-request' })
    assert.deepEqual(f.shadow.snapshot('g').pending.map((p: any) => [p.topicId, p.kind]), [['A', 'question'], ['B', 'question'], ['B', 'approval']])
    f.shadow.closePending('g', b)
    assert.equal(f.shadow.snapshot('g').pending[0].id, a)
    assert.equal(f.shadow.snapshot('g').focus.topicId, 'A')
  } finally { await f.close() }
})

test('a temporary one-off reply returns shadow focus to the ongoing work', async () => {
  const f = await setup()
  try {
    assert.ok(f.shadow)
    f.shadow.record('g', visible('a', 1, 'A'))
    f.shadow.record('g', visible('math', 2, 'M', 'user', { temporary: true, basis: 'arithmetic-form' }))
    assert.equal(f.shadow.snapshot('g').focus.topicId, 'M')
    f.shadow.record('g', visible('math-reply', 3, 'M', 'foreground', { replyTo: 'math', completed: true }))
    assert.equal(f.shadow.snapshot('g').focus.topicId, 'A')
    assert.equal(f.shadow.snapshot('g').focus.messageId, 'a')
    assert.equal(f.shadow.snapshot('g').messages.find((m: any) => m.messageId === 'math').temporary, true)
  } finally { await f.close() }
})

test('late user bindings, replies and temporary completions cannot overwrite newer focus', async () => {
  const f = await setup()
  try {
    assert.ok(f.shadow)
    f.shadow.record('g', visible('a', 1, 'A'))
    f.shadow.record('g', visible('math', 2, 'M', 'user', { temporary: true }))
    f.shadow.record('g', visible('c', 4, 'C'))
    f.shadow.record('g', visible('late', 3, 'B'))
    f.shadow.bind('g', 'main', 'a', { topicId: 'B' })
    f.shadow.record('g', visible('late-math-reply', 5, 'M', 'foreground', { replyTo: 'math', completed: true }))
    assert.equal(f.shadow.snapshot('g').focus.topicId, 'C')
    assert.deepEqual(f.shadow.snapshot('g').messages.map((m: any) => m.seq), [1, 2, 3, 4, 5])
    f.shadow.record('g', visible('latest-c-reply', 8, 'C', 'foreground', { replyTo: 'c', completed: true }))
    f.shadow.record('g', visible('late-c-reply', 7, 'C', 'foreground', { replyTo: 'c', completed: true }))
    assert.equal(f.shadow.snapshot('g').focus.messageId, 'latest-c-reply')
  } finally { await f.close() }
})

test('restart recovers provenance, focus, temporary return and unresolved owners idempotently', async () => {
  const f = await setup()
  let reopened: Awaited<ReturnType<typeof harness>> | undefined
  try {
    assert.ok(f.shadow)
    f.shadow.record('g', visible('a', 1, 'A'))
    f.shadow.openPending('g', { topicId: 'A', kind: 'approval', messageId: 'a', basis: 'host-request' })
    f.shadow.record('g', visible('math', 2, 'M', 'user', { temporary: true }))
    const before = f.shadow.snapshot('g')
    await f.app.close()
    reopened = await harness(f.root)
    const shadow = (reopened.ctx.theone as any).shadow
    assert.deepEqual(shadow.snapshot('g'), before)
    shadow.record('g', visible('math', 2, 'M', 'user', { temporary: true }))
    assert.deepEqual(shadow.snapshot('g'), before)
    shadow.record('g', visible('reply', 3, 'M', 'foreground', { replyTo: 'math', completed: true }))
    assert.equal(shadow.snapshot('g').focus.topicId, 'A')
    assert.equal(shadow.snapshot('g').pending[0].topicId, 'A')
  } finally { await reopened?.close(); await f.close() }
})

test('an actual arithmetic detour preserves product mounting as well as shadow focus', async () => {
  const f = await setup()
  try {
    await ask(f.app.gateway, 'Qwen 那个')
    const before = f.shadow.snapshot('test-gateway').focus
    const result = await ask(f.app.gateway, '插一句，17 + 23 是多少？')
    const route = f.app.ctx.theone.store.route(result.input.id)!
    assert.equal(route.decision.action, 'CREATE')
    assert.equal(f.app.ctx.theone.store.current('test-gateway'), before.topicId)
    const shadow = f.shadow.snapshot('test-gateway')
    assert.equal(shadow.focus.topicId, before.topicId)
    assert.equal(shadow.focus.messageId, before.messageId)
    assert.equal(shadow.messages.find((m: any) => m.messageId === result.input.id).temporary, true)
  } finally { await f.close() }
})

test('late events from an earlier main-chat session cannot replace a newer session focus', async () => {
  const f = await setup()
  try {
    f.shadow.record('g', visible('old', 1, 'A'))
    f.shadow.record('g', { ...visible('new', 1, 'B'), sessionId: 'new-main' })
    f.shadow.record('g', visible('late-old', 99, 'A'))
    assert.equal(f.shadow.snapshot('g').focus.topicId, 'B')
  } finally { await f.close() }
})

test('failed shadow writes cannot stop a real route or its reply', async () => {
  const f = await setup()
  try {
    f.shadow.record = () => { throw new Error('synthetic disk failure') }
    const result = await ask(f.app.gateway, 'Qwen 那个')
    assert.equal(f.app.ctx.theone.store.route(result.input.id)?.decision.contextId, 'ctx_qwen_9070xt')
    assert.ok(result.output)
    assert.equal((f.app.ctx.theone as any).shadowError, 'SHADOW_WRITE_FAILED')
  } finally { await f.close() }
})

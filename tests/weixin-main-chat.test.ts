import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import UserApproval from '@deepseek-ai/dsh-user-approval'
import UserQuestions from '@deepseek-ai/dsh-user-questions'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { IlinkAccount } from '../src/weixin-ilink.ts'
import { WEIXIN_REQUEST } from '../src/weixin.ts'
import { harness, textResponse } from './harness.ts'
import { FakeIlink } from './fake-ilink.ts'

const owner = 'owner@im.wechat'
const account: IlinkAccount = { botId: 'bot-123456789', token: 'secret-token', baseUrl: 'https://bot.example', userId: owner }

/** TheOne with main chat known and a WeChat account bound to a scripted server. */
async function bound(name: string) {
  const root = await mkdtemp(join(tmpdir(), `theone-weixin-${name}-`))
  const app = await harness(root)
  const theone = app.ctx.theone
  theone.store.rememberGateway('test-gateway', app.gateway.id)
  const server = new FakeIlink().answer('getconfig', { typing_ticket: 'ticket-1' })
  theone.weixin.client.fetchImpl = server.fetch
  theone.store.saveRemoteLink('weixin', { account, enabled: true, buf: '' })
  theone.weixin.link.start()
  await server.until('getupdates', 1)
  let id = 100
  return {
    ...app, theone, server,
    /** The owner says `text` in WeChat. */
    say: (text: string, from = owner) => { server.answer('getupdates', { ret: 0, get_updates_buf: `b${++id}`, msgs: [FakeIlink.message(id, from, text)] }); return id },
    close: async () => { await app.close(); await rm(root, { recursive: true, force: true }) },
  }
}

const until = async (check: () => boolean, timeoutMs = 10000) => {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() > deadline) throw new Error('condition not reached')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

test('a WeChat message goes into main chat like a typed one, and the reply comes back to WeChat', { timeout: 30000 }, async () => {
  const app = await bound('reply')
  try {
    const id = app.say('Qwen 显卡那个继续')
    await until(() => app.server.sent.length > 0)
    assert.deepEqual(app.server.sent, [{ to: owner, text: '模拟回答：ctx_qwen_9070xt', contextToken: `ctx-${id}` }])
    // It is an ordinary user message in main chat, routed to its topic like any other.
    const input = app.gateway.session.snapshotEvents().find(event => event.type === 'user/message' && event.data.source.kind === 'user')
    assert.ok(input?.type === 'user/message')
    assert.equal((input.data.source as { rpcId?: string }).rpcId, `${WEIXIN_REQUEST}${id}`)
    assert.equal(app.theone.store.route(input.data.id)?.decision.contextId, 'ctx_qwen_9070xt')
    // "Typing…" was shown while main chat worked on it.
    await app.server.until('sendtyping', 1)
    assert.equal(app.server.requests.find(request => request.path.endsWith('sendtyping'))?.body?.typing_ticket, 'ticket-1')
    // Someone else's message never reaches main chat.
    const turns = app.gateway.session.snapshotEvents().filter(event => event.type === 'turn/start').length
    app.say('你好，我是陌生人', 'stranger@im.wechat')
    // The next poll starts only after that round was handled.
    await app.server.until('getupdates', 3)
    assert.equal(app.gateway.session.snapshotEvents().filter(event => event.type === 'turn/start').length, turns)
    assert.equal(app.server.sent.length, 1)
  } finally { await app.close() }
})

test('a reply typed in the browser stays there; only turns answering WeChat go back to it', { timeout: 30000 }, async () => {
  const app = await bound('browser')
  try {
    const { ask } = await import('./harness.ts')
    const result = await ask(app.gateway, 'Qwen 那个')
    assert.equal(result.output.includes('模拟回答'), true)
    await new Promise(resolve => setTimeout(resolve, 50))
    assert.equal(app.server.sent.length, 0)
  } finally { await app.close() }
})

test('Markdown in a reply reaches WeChat as plain text', { timeout: 30000 }, async () => {
  const app = await bound('markdown')
  try {
    app.model.behavior = async function* () { yield* textResponse('## 结论\n\n**改第三章**，见 [说明](https://example.com)：\n\n- 删掉 `table 2`\n- 补实验') }
    app.say('Qwen 那个')
    await until(() => app.server.sent.length > 0)
    assert.equal(app.server.sent[0].text, '结论\n\n改第三章，见 说明 (https://example.com)：\n\n• 删掉 table 2\n• 补实验')
  } finally { await app.close() }
})

test('an approval raised while answering WeChat is asked in WeChat and answered with a number', { timeout: 30000 }, async () => {
  const app = await bound('approval')
  let outcome: string | undefined
  let browserAsked = 0
  try {
    await app.ctx.plugin(UserApproval, { policy: 'ask' })
    app.ctx.on('approval/request', async (_request, next) => { browserAsked++; return next() })
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
      } else yield* textResponse(`结果：${outcome}`)
    }
    app.say('Qwen 那个，改一下 hosts')
    await until(() => app.server.sent.length > 0)
    assert.match(app.server.sent[0].text, /需要你确认一步操作/)
    assert.match(app.server.sent[0].text, /guarded_write \{"path":"\/etc\/hosts"\}/)
    assert.match(app.server.sent[0].text, /回 1 允许，回 2 拒绝/)
    // Something that is not an answer gets a reminder; it is not sent to main chat.
    app.say('啥意思')
    await until(() => app.server.sent.length > 1)
    assert.equal(app.server.sent[1].text, '请回 1 允许，或回 2 拒绝。')
    app.say('1')
    await until(() => app.server.sent.length > 2)
    assert.equal(outcome, 'allowed-once')
    assert.equal(app.server.sent[2].text, '结果：allowed-once')
    assert.equal(browserAsked, 0)
    assert.equal(app.gateway.session.snapshotEvents().filter(event => event.type === 'user/message' && event.data.source.kind === 'user').length, 1)
  } finally { await app.close() }
})

test('an approval nobody answers in WeChat is declined after the wait', { timeout: 30000 }, async () => {
  const app = await bound('timeout')
  let outcome: string | undefined
  try {
    await app.ctx.plugin(UserApproval, { policy: 'ask' })
    app.theone.weixin.relay.askTimeoutMs = 50
    app.ctx.tools.register(defineTool({ name: 'guarded_write', description: 'Synthetic guarded tool', parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value: string) => [{ type: 'text', text: value }] },
      execute: async (_args, exec) => (outcome = await app.ctx.approval.request({ agent: exec.agent!, toolName: 'guarded_write', callId: exec.callId, signal: exec.signal })) }))
    let calls = 0
    app.model.behavior = async function* () {
      if (calls++ === 0) {
        const id = ToolCallId('guarded-call')
        yield { type: 'block-start', index: 0, blockType: 'tool-call' }
        yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'guarded_write', arguments: '{}' } }
        yield { type: 'finish', reason: { kind: 'tool-calls' } }
      } else yield* textResponse(`结果：${outcome}`)
    }
    app.say('Qwen 那个')
    await until(() => app.server.sent.length > 1)
    assert.equal(outcome, 'rejected')
    assert.equal(app.server.sent[1].text, '结果：rejected')
  } finally { await app.close() }
})

test('a question raised while answering WeChat is asked there; a number picks an option, words answer freely', { timeout: 30000 }, async () => {
  const app = await bound('question')
  let answer: unknown
  try {
    await app.ctx.plugin(UserQuestions)
    app.ctx.tools.register(defineTool({ name: 'pick', description: 'Synthetic question tool', parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value: string) => [{ type: 'text', text: value }] },
      execute: async (_args, exec) => {
        answer = await app.ctx.userQuestions.ask({ agent: exec.agent!, questions: [
          { id: 'q1', header: '酒店', question: '订哪家？', options: [{ label: '如家' }, { label: '全季', description: '贵一点' }] },
          { id: 'q2', question: '几点入住？' },
        ] } as never)
        return 'ok'
      } }))
    let calls = 0
    app.model.behavior = async function* () {
      if (calls++ === 0) {
        const id = ToolCallId('pick-call')
        yield { type: 'block-start', index: 0, blockType: 'tool-call' }
        yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'pick', arguments: '{}' } }
        yield { type: 'finish', reason: { kind: 'tool-calls' } }
      } else yield* textResponse('订好了')
    }
    app.say('Qwen 那个')
    await until(() => app.server.sent.length > 0)
    assert.equal(app.server.sent[0].text, '【酒店】\n订哪家？\n\n1. 如家\n2. 全季：贵一点\n\n回编号选择，也可以直接打字回答。')
    app.say('2')
    await until(() => app.server.sent.length > 1)
    assert.equal(app.server.sent[1].text, '几点入住？\n\n直接打字回答。')
    app.say('下午三点左右')
    await until(() => app.server.sent.length > 2)
    assert.deepEqual(answer, { answers: [{ id: 'q1', selected: ['全季'] }, { id: 'q2', selected: [], custom: '下午三点左右' }] })
    assert.equal(app.server.sent[2].text, '订好了')
  } finally { await app.close() }
})

test('without a main chat yet, WeChat is told to open it once', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-weixin-nochat-'))
  const app = await harness(root)
  try {
    const server = new FakeIlink()
    app.ctx.theone.weixin.client.fetchImpl = server.fetch
    app.ctx.theone.store.saveRemoteLink('weixin', { account, enabled: true, buf: '' })
    app.ctx.theone.weixin.link.start()
    server.answer('getupdates', { ret: 0, get_updates_buf: 'b1', msgs: [FakeIlink.message(1, owner, '在吗')] })
    await until(() => server.sent.length > 0)
    assert.match(server.sent[0].text, /请先在电脑上打开一次「TheOne · 主聊天」/)
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('the settings route reports status without the token, and pauses, resumes and logs out', { timeout: 30000 }, async () => {
  const app = await bound('route')
  try {
    const call = async (body?: Record<string, unknown>) => (await app.theone.weixin.handle(new Request('http://dsh/api/theone/weixin', body
      ? { method: 'POST', body: JSON.stringify(body) } : {}))).json() as Promise<Record<string, unknown>>
    const status = await call()
    assert.equal(status.state, 'online')
    assert.equal(status.account, 'bot-1234')
    assert.equal(JSON.stringify(status).includes('secret-token'), false)
    assert.equal((await call({ action: 'disable' })).state, 'off')
    assert.equal((await call({ action: 'enable' })).state, 'online')
    assert.equal((await app.theone.weixin.handle(new Request('http://dsh/api/theone/weixin', { method: 'POST', body: JSON.stringify({ action: 'verify', code: 'x y z; drop' }) }))).status, 400)
    assert.equal((await call({ action: 'logout' })).state, 'off')
    assert.equal(app.theone.store.remoteLink('weixin'), undefined)
  } finally { await app.close() }
})

test('when the WeChat login expires for good, main chat says so', { timeout: 30000 }, async () => {
  const app = await bound('expired')
  try {
    ;(app.theone.weixin.link as unknown as { deps: { expired(): void } }).deps.expired()
    await app.gateway.whenIdle()
    const note = app.gateway.session.snapshotEvents().find(event => event.type === 'user/message' && event.data.source.kind === 'theone-note')
    assert.ok(note?.type === 'user/message')
    assert.match(note.data.content.map(block => block.type === 'text' ? block.text : '').join(''), /微信登录已失效/)
  } finally { await app.close() }
})

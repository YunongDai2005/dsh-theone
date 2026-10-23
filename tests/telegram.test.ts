import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TELEGRAM_REQUEST } from '../src/telegram.ts'
import { harness } from './harness.ts'
import { FakeTelegram } from './fake-telegram.ts'

const TOKEN = '123456789:AAEexampleexampleexampleexampleexample'

async function app(name: string) {
  const root = await mkdtemp(join(tmpdir(), `theone-telegram-${name}-`))
  const base = await harness(root)
  const theone = base.ctx.theone
  theone.store.rememberGateway('test-gateway', base.gateway.id)
  const server = new FakeTelegram()
  theone.telegram.client.fetchImpl = server.fetch
  const call = async (body?: Record<string, unknown>) => {
    const response = await theone.telegram.handle(new Request('http://dsh/api/theone/telegram', body ? { method: 'POST', body: JSON.stringify(body) } : {}))
    return { status: response.status, body: await response.json() as Record<string, unknown> }
  }
  return { ...base, theone, server, call, close: async () => { await base.close(); await rm(root, { recursive: true, force: true }) } }
}

const until = async (check: () => boolean, timeoutMs = 10000) => {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() > deadline) throw new Error('condition not reached')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

test('a pasted token is checked with Telegram; the first person to send the pairing code becomes the owner', { timeout: 30000 }, async () => {
  const t = await app('pair')
  try {
    assert.deepEqual(await t.call({ action: 'connect', token: 'not a token' }), { status: 400, body: { error: 'TELEGRAM_TOKEN_INVALID' } })
    t.server.answer('getMe', { ok: false, error_code: 401, description: 'Unauthorized' })
    assert.deepEqual((await t.call({ action: 'connect', token: TOKEN })).body, { error: 'TELEGRAM_TOKEN_INVALID' })
    const connected = await t.call({ action: 'connect', token: ` ${TOKEN} ` })
    assert.equal(connected.status, 200)
    const pairing = connected.body.pairing as { bot: string; code: string }
    assert.equal(pairing.bot, 'theone_test_bot')
    assert.match(pairing.code, /^\d{6}$/)
    assert.equal(connected.body.account, '@theone_test_bot')
    assert.equal(JSON.stringify(connected.body).includes(TOKEN), false)
    // Before pairing, nobody reaches main chat.
    t.server.say('你好', { id: 7, first_name: 'Stranger', username: 'stranger' })
    t.server.say(`/start ${pairing.code}`)
    await until(() => t.server.sent.length > 0)
    assert.equal(t.server.sent[0].chatId, 42)
    assert.match(t.server.sent[0].text, /已和 TheOne 绑定/)
    assert.equal((await t.call()).body.pairing, undefined)
    assert.deepEqual(t.theone.store.remoteLink<{ owner: unknown }>('telegram')?.owner, { userId: 42, chatId: 42, name: '@owner' })
    assert.equal(t.gateway.session.snapshotEvents().some(event => event.type === 'user/message' && event.data.source.kind === 'user'), false)
    // Sending the code again after pairing does nothing; someone else's message is ignored.
    const last = t.server.say(pairing.code, { id: 7, first_name: 'Stranger', username: 'stranger' })
    await until(() => t.theone.store.remoteLink<{ cursor: string }>('telegram')?.cursor === String(last + 1))
    assert.equal(t.server.sent.length, 1)
  } finally { await t.close() }
})

test('the owner\'s Telegram message goes into main chat, and the reply comes back as plain text', { timeout: 30000 }, async () => {
  const t = await app('reply')
  try {
    t.theone.store.saveRemoteLink('telegram', { token: TOKEN, bot: 'theone_test_bot', owner: { userId: 42, chatId: 42, name: '@owner' }, enabled: true, cursor: '' })
    t.theone.telegram.link.start()
    const id = t.server.say('Qwen 显卡那个继续')
    await until(() => t.server.sent.length > 0)
    assert.deepEqual(t.server.sent, [{ chatId: 42, text: '模拟回答：ctx_qwen_9070xt' }])
    const input = t.gateway.session.snapshotEvents().find(event => event.type === 'user/message' && event.data.source.kind === 'user')
    assert.ok(input?.type === 'user/message')
    assert.equal((input.data.source as { rpcId?: string }).rpcId, `${TELEGRAM_REQUEST}${id}`)
    await t.server.until('sendChatAction', 1)
    // The cursor moved past the update, so a restart does not deliver it again.
    assert.equal(t.theone.store.remoteLink<{ cursor: string }>('telegram')?.cursor, String(id + 1))
    const updates = t.server.calls.filter(call => call.method === 'getUpdates')
    assert.equal(updates.at(-1)!.body.offset, id + 1)
    assert.equal(updates.at(-1)!.body.timeout, 30)
    assert.deepEqual(updates.at(-1)!.body.allowed_updates, ['message'])
    // A group chat, even with the owner in it, does not reach main chat.
    t.server.say('群里说的', { id: 42, first_name: 'Owner', username: 'owner' }, { id: -100, type: 'group' })
    await t.server.until('getUpdates', updates.length + 1)
    assert.equal(t.gateway.session.snapshotEvents().filter(event => event.type === 'user/message' && event.data.source.kind === 'user').length, 1)
  } finally { await t.close() }
})

test('a revoked token stops receiving and says so in main chat; a webhook left on the bot is cleared once', { timeout: 30000 }, async () => {
  const t = await app('expired')
  try {
    t.theone.store.saveRemoteLink('telegram', { token: TOKEN, bot: 'theone_test_bot', owner: { userId: 42, chatId: 42, name: '@owner' }, enabled: true, cursor: '' })
    t.server.answer('getUpdates', { ok: false, error_code: 409, description: 'Conflict: can\'t use getUpdates method while webhook is active' })
    t.theone.telegram.link.start()
    await t.server.until('deleteWebhook', 1)
    t.server.answer('getUpdates', { ok: false, error_code: 401, description: 'Unauthorized' })
    await until(() => t.theone.telegram.link.status().state === 'expired')
    await t.gateway.whenIdle()
    const note = t.gateway.session.snapshotEvents().find(event => event.type === 'user/message' && event.data.source.kind === 'theone-note')
    assert.ok(note?.type === 'user/message')
    assert.match(note.data.content.map(block => block.type === 'text' ? block.text : '').join(''), /Telegram 机器人的 token 已失效/)
  } finally { await t.close() }
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { IlinkClient, TEXT_LIMIT, clientVersion, messageWords, type IlinkAccount } from '../src/weixin-ilink.ts'
import { splitText } from '../src/remote-plain.ts'
import type { LinkMessage } from '../src/remote-link.ts'
import { WeixinLink, type WeixinSaved } from '../src/weixin-link.ts'
import { backoff } from '../src/remote-link.ts'
import { FakeIlink } from './fake-ilink.ts'

const account: IlinkAccount = { botId: 'bot-123456789', token: 'secret-token', baseUrl: 'https://bot.example', userId: 'owner@im.wechat' }

/** A link over a fake server with a clock that jumps instead of waiting. */
function setup(saved?: WeixinSaved) {
  const server = new FakeIlink()
  const client = new IlinkClient('0.3.33', server.fetch)
  let store = saved
  let clock = 1_000_000
  const delivered: LinkMessage[] = []
  const sleeps: number[] = []
  let expired = 0
  const link = new WeixinLink(client, {
    load: () => store,
    save: value => { store = value },
    deliver: async message => { delivered.push(message) },
    expired: () => { expired++ },
    now: () => clock,
    random: () => 0.5,
    sleep: async (ms, signal) => {
      sleeps.push(ms)
      clock += ms
      await new Promise(resolve => setImmediate(resolve))
      signal.throwIfAborted()
    },
  })
  return { server, client, link, delivered, sleeps, saved: () => store, expired: () => expired }
}

const until = async (check: () => boolean, timeoutMs = 3000) => {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() > deadline) throw new Error('condition not reached')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

test('words come from text items and the transcript of a voice message; long replies split at line breaks', () => {
  assert.equal(messageWords([{ type: 1, text_item: { text: '你好' } }, { type: 3, voice_item: { text: '语音转的字' } }, { type: 2 }]), '你好\n语音转的字')
  assert.equal(messageWords(undefined), '')
  const long = `${'a'.repeat(3000)}\n\n${'b'.repeat(3000)}`
  assert.deepEqual(splitText(long, TEXT_LIMIT).map(part => part.length), [3000, 3000])
  assert.deepEqual(splitText('x'.repeat(9000), TEXT_LIMIT).map(part => part.length), [4000, 4000, 1000])
  assert.equal(clientVersion('1.0.11'), 0x0001000b)
})

test('requests carry the app id, client version and bot token; a reply carries the conversation token', async () => {
  const server = new FakeIlink()
  const client = new IlinkClient('0.3.33', server.fetch)
  await client.send(account, 'owner@im.wechat', '好的', 'ctx-1')
  const request = server.requests[0]
  assert.equal(request.host, 'bot.example')
  assert.equal(request.path, '/ilink/bot/sendmessage')
  assert.equal(request.headers['iLink-App-Id'], 'bot')
  assert.equal(request.headers['iLink-App-ClientVersion'], String(clientVersion('0.3.33')))
  assert.equal(request.headers.Authorization, 'Bearer secret-token')
  assert.deepEqual(server.sent, [{ to: 'owner@im.wechat', text: '好的', contextToken: 'ctx-1' }])
  server.answer('sendmessage', { ret: -1 })
  await assert.rejects(client.send(account, 'owner@im.wechat', 'x'), /ILINK_SEND_FAILED/)
})

test('a long poll that times out on our side is an empty round, not a failure; -14 reads as stale', async () => {
  const server = new FakeIlink()
  const client = new IlinkClient('0.3.33', server.fetch)
  // The client waits 5 s past the server's hold; a negative hold makes that a few milliseconds here.
  assert.deepEqual(await client.updates(account, 'cursor', -4980), { kind: 'ok', messages: [], buf: 'cursor' })
  server.answer('getupdates', { ret: -14 }, { errcode: 500, errmsg: 'busy' })
  assert.deepEqual(await client.updates(account, 'cursor'), { kind: 'stale' })
  assert.deepEqual(await client.updates(account, 'cursor'), { kind: 'error', message: 'ret=0 errcode=500 busy' })
  server.answer('getupdates', { ret: 0, get_updates_buf: 'next', longpolling_timeout_ms: 20000, msgs: [
    FakeIlink.message(1, 'owner@im.wechat', '在吗'),
    FakeIlink.message(2, 'bot-123456789', '机器人自己的消息', { message_type: 2 }),
    FakeIlink.message(3, 'someone@im.wechat', '群里的', { group_id: 'g1' }),
  ] })
  assert.deepEqual(await client.updates(account, 'cursor'), { kind: 'ok', buf: 'next', nextTimeoutMs: 20000,
    messages: [{ id: '1', from: 'owner@im.wechat', text: '在吗', contextToken: 'ctx-1' }] })
})

test('scanning the code binds the account and starts receiving; only the owner reaches main chat, once', async () => {
  const { server, link, delivered, saved } = setup()
  server.answer('get_bot_qrcode', { qrcode: 'q1', qrcode_img_content: 'https://weixin.example/q1' })
  server.answer('get_qrcode_status', { status: 'wait' }, { status: 'scaned' })
  assert.deepEqual(await link.beginLogin(), { step: 'qr', url: 'https://weixin.example/q1' })
  await server.until('get_qrcode_status', 3)
  assert.deepEqual(link.status().login, { step: 'scanned' })
  server.answer('get_qrcode_status', { status: 'confirmed', bot_token: 'secret-token', ilink_bot_id: 'bot-123456789', ilink_user_id: 'owner@im.wechat', baseurl: 'https://bot.example' })
  await server.until('notifystart', 1)
  assert.deepEqual(saved(), { account, enabled: true, cursor: '' })
  assert.equal(link.status().login, undefined)
  assert.equal(link.status().account, 'bot-1234')
  const round = { ret: 0, get_updates_buf: 'b1', msgs: [FakeIlink.message(7, 'owner@im.wechat', '帮我看下周末的酒店'), FakeIlink.message(8, 'stranger@im.wechat', '你好')] }
  server.answer('getupdates', round)
  await until(() => saved()?.cursor === 'b1')
  assert.deepEqual(delivered.map(message => message.text), ['帮我看下周末的酒店'])
  assert.equal(saved()?.contextToken, 'ctx-7')
  // A round the server repeats (we crashed before saving the cursor) is not delivered again.
  server.answer('getupdates', { ...round, get_updates_buf: 'b2' })
  await until(() => saved()?.cursor === 'b2')
  assert.equal(delivered.length, 1)
  assert.equal(link.status().state, 'online')
  await link.stop()
  await server.until('notifystop', 1)
  assert.equal(server.requests.filter(request => request.path.endsWith('getupdates')).every(request => request.headers.Authorization === 'Bearer secret-token'), true)
})

test('a code that expires is replaced, and a verification code is passed on when WeChat asks for one', async () => {
  const { server, link } = setup()
  server.answer('get_bot_qrcode', { qrcode: 'q1', qrcode_img_content: 'https://weixin.example/q1' }, { qrcode: 'q2', qrcode_img_content: 'https://weixin.example/q2' })
  server.answer('get_qrcode_status', { status: 'expired' })
  await link.beginLogin()
  await server.until('get_bot_qrcode', 2)
  await until(() => link.status().login?.step === 'qr' && (link.status().login as { url: string }).url.endsWith('q2'))
  server.answer('get_qrcode_status', { status: 'scaned_but_redirect', redirect_host: 'other.example' }, { status: 'need_verifycode' })
  await until(() => link.status().login?.step === 'verify')
  link.verify(' 123456 ')
  server.answer('get_qrcode_status', { status: 'binded_redirect' })
  await until(() => link.status().login?.step === 'failed')
  const asked = server.requests.filter(request => request.path.endsWith('get_qrcode_status'))
  assert.equal(asked.at(-1)!.query.get('verify_code'), '123456')
  assert.equal(asked.at(-1)!.host, 'other.example')
  assert.equal(asked.at(-1)!.query.get('qrcode'), 'q2')
  assert.deepEqual(link.status().login, { step: 'failed', reason: 'ALREADY_BOUND' })
})

test('failures back off and recover; an expired token pauses an hour, and a second refusal asks to scan again', async () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 10].map(n => backoff(n, () => 0.5)), [2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000])
  assert.equal(backoff(1, () => 0), 1600)
  const { server, link, sleeps, saved, expired } = setup({ account, enabled: true, cursor: 'b0' })
  server.answer('getupdates', { errcode: 500 }, { errcode: 500 }, { ret: 0, get_updates_buf: 'b1' })
  link.start()
  await until(() => saved()?.cursor === 'b1')
  assert.deepEqual(sleeps, [2000, 4000])
  assert.equal(link.status().lastError, undefined)
  server.answer('getupdates', { ret: -14 })
  await until(() => sleeps.includes(60 * 60_000))
  server.answer('getupdates', { ret: -14 })
  await until(() => saved()?.expired === true)
  assert.equal(expired(), 1)
  assert.equal(link.status().state, 'expired')
  assert.equal(link.account(), undefined)
  // Receiving does not start again on its own with an expired token.
  link.start()
  assert.equal(link.status().state, 'expired')
})

test('pausing stops receiving and keeps the login; logging out forgets it', async () => {
  const { server, link, saved } = setup({ account, enabled: true, cursor: '' })
  link.start()
  await server.until('getupdates', 1)
  await link.setEnabled(false)
  assert.equal(link.status().state, 'off')
  assert.equal(saved()?.enabled, false)
  link.start()
  assert.equal(link.status().state, 'off')
  await link.setEnabled(true)
  await server.until('getupdates', 2)
  assert.equal(link.status().state, 'online')
  await link.logout()
  assert.equal(saved(), undefined)
  assert.equal(link.status().state, 'off')
})

test('a loop that stops polling is started again by the watchdog', async () => {
  const { server, link } = setup({ account, enabled: true, cursor: '' })
  const clock = { now: 1_000_000 }
  ;(link as unknown as { now: () => number }).now = () => clock.now
  link.start()
  await server.until('getupdates', 1)
  const check = () => (link as unknown as { checkBeat(): void }).checkBeat()
  check()
  // Held for less than three long-poll periods: still fine.
  clock.now += 60_000
  check()
  assert.equal(server.requests.filter(request => request.path.endsWith('getupdates')).length, 1)
  clock.now += 120_000
  check()
  await server.until('getupdates', 2)
  assert.equal(link.status().state, 'online')
  await link.stop()
})

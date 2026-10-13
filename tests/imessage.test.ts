import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { IMessageLink, MessagesDatabase, attributedText, imessageSource, sameHandle, type IMessageSaved } from '../src/imessage-db.ts'
import { IMESSAGE_REQUEST } from '../src/imessage.ts'
import { harness } from './harness.ts'

const OWNER = '+86 138 0013 8000'

/** A Messages database with the tables and columns TheOne reads. */
class FakeMessages {
  readonly db: DatabaseSync
  private chats = new Map<string, number>()
  private handles = new Map<string, number>()

  constructor(readonly path: string, readonly account = 'E:mac@icloud.com') {
    this.db = new DatabaseSync(path)
    this.db.exec(`CREATE TABLE handle (ROWID INTEGER PRIMARY KEY, id TEXT);
      CREATE TABLE chat (ROWID INTEGER PRIMARY KEY, chat_identifier TEXT, style INTEGER);
      CREATE TABLE message (ROWID INTEGER PRIMARY KEY, text TEXT, attributedBody BLOB, is_from_me INTEGER, handle_id INTEGER, account TEXT);
      CREATE TABLE chat_message_join (chat_id INTEGER, message_id INTEGER);`)
  }

  private id(map: Map<string, number>, table: string, key: string, extra: Record<string, unknown> = {}): number {
    if (!map.has(key)) {
      const columns = table === 'handle' ? { id: key } : { chat_identifier: key, ...extra }
      const result = this.db.prepare(`INSERT INTO ${table} (${Object.keys(columns).join(', ')}) VALUES (${Object.keys(columns).map(() => '?').join(', ')})`).run(...Object.values(columns) as never[])
      map.set(key, Number(result.lastInsertRowid))
    }
    return map.get(key)!
  }

  /** One message in the one-to-one chat with `who` (or a group when `group`). */
  add(who: string, text: string | null, options: { mine?: boolean; group?: string; body?: Uint8Array } = {}): number {
    const handle = this.id(this.handles, 'handle', who)
    const chat = this.id(this.chats, 'chat', options.group ?? who, { style: options.group ? 43 : 45 })
    const row = this.db.prepare('INSERT INTO message (text, attributedBody, is_from_me, handle_id, account) VALUES (?, ?, ?, ?, ?)')
      .run(text, options.body ?? null, options.mine ? 1 : 0, handle, this.account)
    this.db.prepare('INSERT INTO chat_message_join VALUES (?, ?)').run(chat, row.lastInsertRowid)
    return Number(row.lastInsertRowid)
  }
}

/** How newer macOS stores a message's text: an NSAttributedString with the string after "NSString". */
function attributed(text: string): Uint8Array {
  const bytes = Buffer.from(text)
  const length = bytes.length < 0x80 ? Buffer.from([bytes.length]) : Buffer.concat([Buffer.from([0x81]), Buffer.from([bytes.length & 0xff, bytes.length >> 8])])
  return Buffer.concat([Buffer.from('\x04\x0bstreamtyped\x81\xe8\x03\x84\x01@\x84\x84\x84\x12NSAttributedString\x00\x84\x84\x08NSObject\x00\x85\x92\x84\x84\x84\x08NSString\x01\x94\x84\x01+', 'latin1'), length, bytes, Buffer.from([0x86, 0x84])])
}

async function setup(name: string) {
  const root = await mkdtemp(join(tmpdir(), `theone-imessage-${name}-`))
  const messages = new FakeMessages(join(root, 'chat.db'))
  const db = new MessagesDatabase()
  db.path = messages.path
  const sent: string[][] = []
  db.run = async (file, args) => { sent.push([file, ...args]) }
  return { root, messages, db, sent, close: () => rm(root, { recursive: true, force: true }) }
}

test('handles match across spelling, and text stored only in attributedBody is read', () => {
  assert.equal(sameHandle('+86 138 0013 8000', '13800138000'), true)
  assert.equal(sameHandle('+1 (555) 010-9999', '15550109999'), true)
  assert.equal(sameHandle('Me@iCloud.com', 'me@icloud.com'), true)
  assert.equal(sameHandle('13800138000', '13800138001'), false)
  assert.equal(attributedText(attributed('帮我看下明天的日程')), '帮我看下明天的日程')
  const long = '长'.repeat(100)
  assert.equal(attributedText(attributed(long)), long)
  assert.equal(attributedText(null), '')
})

test('only the owner\'s one-to-one messages after connecting are read, and a reply goes out through Messages', async () => {
  const s = await setup('owner')
  try {
    s.messages.add(OWNER, '连接之前的旧消息')
    let saved: IMessageSaved | undefined
    const delivered: string[] = []
    const link = new IMessageLink(s.db, { load: () => saved, save: value => { saved = value }, deliver: async message => { delivered.push(message.text) } }, 'linux')
    await assert.rejects(link.connect(OWNER), /IMESSAGE_UNSUPPORTED/)
    assert.equal(link.status().supported, false)
    const mac = new IMessageLink(s.db, { load: () => saved, save: value => { saved = value }, deliver: async message => { delivered.push(message.text) } }, 'darwin')
    await assert.rejects(mac.connect('not a handle'), /IMESSAGE_HANDLE_INVALID/)
    await mac.connect('13800138000')
    // Rounds are driven by hand below.
    await mac.stop()
    assert.deepEqual({ handle: saved?.handle, self: saved?.self, enabled: saved?.enabled, cursor: saved?.cursor }, { handle: '13800138000', self: false, enabled: true, cursor: '1' })
    s.messages.add(OWNER, '帮我看下明天的日程')
    s.messages.add('+86 139 0000 0000', '陌生人')
    s.messages.add(OWNER, '我自己在电脑上回的', { mine: true })
    s.messages.add(OWNER, '群里的', { group: 'chat123' })
    s.messages.add(OWNER, null, { body: attributed('新系统存的') })
    const source = imessageSource(s.db)
    const round = await source.poll(saved!, 0, new AbortController().signal)
    assert.ok(round.kind === 'ok')
    assert.deepEqual(round.messages.map(message => message.text), ['帮我看下明天的日程', '新系统存的'])
    assert.equal(round.cursor, '6')
    await s.db.send('13800138000', '好的，明天上午有两个会')
    assert.equal(s.sent[0][0], 'osascript')
    assert.deepEqual(s.sent[0].slice(-2), ['13800138000', '好的，明天上午有两个会'])
    // The text is an argument, never part of the script.
    assert.equal(s.sent[0].filter(arg => arg.includes('明天上午')).length, 1)
  } finally { await s.close() }
})

test('texting oneself: the user\'s messages count even though they are "sent", ours and duplicate copies do not', async () => {
  const s = await setup('self')
  try {
    let saved: IMessageSaved | undefined
    const link = new IMessageLink(s.db, { load: () => saved, save: value => { saved = value }, deliver: async () => {} }, 'darwin')
    s.messages.add('mac@icloud.com', '初始化', { mine: true })
    await link.connect('mac@icloud.com')
    await link.stop()
    assert.equal(saved?.self, true)
    await s.db.send('mac@icloud.com', 'TheOne 的回复')
    s.messages.add('mac@icloud.com', '在手机上发给自己', { mine: true })
    s.messages.add('mac@icloud.com', '在手机上发给自己')
    s.messages.add('mac@icloud.com', 'TheOne 的回复', { mine: true })
    s.messages.add('mac@icloud.com', 'TheOne 的回复')
    const round = await imessageSource(s.db).poll(saved!, 0, new AbortController().signal)
    assert.ok(round.kind === 'ok')
    assert.deepEqual(round.messages.map(message => message.text), ['在手机上发给自己'])
  } finally { await s.close() }
})

test('an iMessage goes into main chat and the reply is sent back to the owner', { timeout: 30000 }, async () => {
  const s = await setup('main')
  const app = await harness(s.root)
  try {
    const theone = app.ctx.theone
    theone.store.rememberGateway('test-gateway', app.gateway.id)
    theone.imessage.db.path = s.messages.path
    theone.imessage.db.run = s.db.run
    ;(theone.imessage.link as unknown as { platform: string }).platform = 'darwin'
    const connected = await (await theone.imessage.handle(new Request('http://dsh/api/theone/imessage', { method: 'POST', body: JSON.stringify({ action: 'connect', handle: OWNER }) }))).json() as Record<string, unknown>
    assert.equal(connected.state, 'online')
    assert.equal(connected.supported, true)
    const row = s.messages.add(OWNER, 'Qwen 显卡那个继续')
    const deadline = Date.now() + 15000
    while (!s.sent.length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20))
    assert.deepEqual(s.sent.map(args => args.slice(-2)), [[OWNER, '模拟回答：ctx_qwen_9070xt']])
    const input = app.gateway.session.snapshotEvents().find(event => event.type === 'user/message' && event.data.source.kind === 'user')
    assert.ok(input?.type === 'user/message')
    assert.equal((input.data.source as { rpcId?: string }).rpcId, `${IMESSAGE_REQUEST}${row}`)
  } finally { await app.close(); await s.close() }
})

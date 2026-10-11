import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { handle, LIMITS, mimeMessage, reportEmail, SCHEMA, sweep } from '../handler.js'

/** D1's prepare/bind/first/run over an in-memory SQLite database. */
function fakeD1() {
  const db = new DatabaseSync(':memory:')
  db.exec(SCHEMA)
  return {
    raw: db,
    prepare(sql) {
      const statement = db.prepare(sql)
      const bound = (args = []) => ({
        first: async () => statement.get(...args) ?? null,
        run: async () => statement.run(...args),
        all: async () => ({ results: statement.all(...args) }),
      })
      return { bind: (...args) => bound(args), ...bound() }
    },
  }
}

const report = (extra = {}) => ({ v: 1, app: 'theone', version: '0.3.22', lang: 'zh', description: '回复里出现乱码\n第二行', ...extra })
const post = (body, ip = '1.2.3.4') => new Request('https://feedback.yulid.org/v1/reports', {
  method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip }, body: typeof body === 'string' ? body : JSON.stringify(body),
})

test('a report is stored, emailed once and answered with an id', async () => {
  const db = fakeD1()
  const mails = []
  const response = await handle(post(report({ contact: ' qq 123 ', diagnostics: { version: '0.3.22' } })), { db, salt: 's', sendMail: async mail => { mails.push(mail) } })
  assert.equal(response.status, 201)
  const { id } = await response.json()
  assert.match(id, /^FB-[A-Z2-9]{6}$/)
  const row = db.raw.prepare('SELECT * FROM reports').get()
  assert.equal(row.id, id)
  assert.equal(row.contact, 'qq 123')
  assert.equal(row.emailed, 1)
  assert.equal(JSON.parse(row.diagnostics).version, '0.3.22')
  assert.equal(mails.length, 1)
  assert.match(mails[0].subject, new RegExp(`^\\[TheOne ${id}\\] 0\\.3\\.22 · 回复里出现乱码$`))
  // No address is stored with the report; only a salted hash, in the rate-limit table.
  assert.ok(!JSON.stringify(row).includes('1.2.3.4'))
  assert.ok(!JSON.stringify(db.raw.prepare('SELECT * FROM hits').all()).includes('1.2.3.4'))
})

test('bad input is refused before anything is stored', async () => {
  const db = fakeD1()
  const deps = { db, sendMail: async () => { throw new Error('no mail expected') } }
  for (const [body, status, error] of [
    ['{not json', 400, 'INVALID'],
    [report({ app: 'other' }), 400, 'INVALID'],
    [report({ version: '0.3; DROP' }), 400, 'INVALID_VERSION'],
    [report({ description: '  ' }), 400, 'DESCRIPTION_REQUIRED'],
    [report({ description: 'x'.repeat(LIMITS.description + 1) }), 413, 'TOO_LARGE'],
    [report({ reply: { main: 'x'.repeat(LIMITS.reply) } }), 413, 'TOO_LARGE'],
    [report({ diagnostics: ['list'] }), 400, 'INVALID'],
  ]) {
    const response = await handle(post(body), deps)
    assert.equal(response.status, status, JSON.stringify(body).slice(0, 60))
    assert.equal((await response.json()).error, error)
  }
  const huge = await handle(post('x'.repeat(LIMITS.body + 1)), deps)
  assert.equal(huge.status, 413)
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM reports').get().n, 0)
  assert.equal((await handle(new Request('https://feedback.yulid.org/v1/reports'), deps)).status, 405)
  assert.equal((await handle(new Request('https://feedback.yulid.org/'), deps)).status, 404)
})

test('one sender is limited per hour; emails stop at the daily cap but reports are kept', async () => {
  const db = fakeD1()
  let now = Date.UTC(2026, 9, 6, 8)
  let mails = 0
  const deps = { db, now: () => now, sendMail: async () => { mails++ } }
  for (let i = 0; i < LIMITS.perHour; i++) assert.equal((await handle(post(report()), deps)).status, 201)
  assert.equal((await handle(post(report()), deps)).status, 429)
  assert.equal((await handle(post(report(), '5.6.7.8'), deps)).status, 201)
  now += 3600001
  assert.equal((await handle(post(report()), deps)).status, 201)

  for (let i = 0; mails < LIMITS.emailsPerDay; i++) assert.equal((await handle(post(report(), `10.0.0.${i}`), deps)).status, 201)
  assert.equal((await handle(post(report(), '10.1.0.1'), deps)).status, 201)
  assert.equal(mails, LIMITS.emailsPerDay)
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM reports WHERE emailed = 0').get().n, 1)
})

test('a failed email still stores the report', async () => {
  const db = fakeD1()
  const response = await handle(post(report()), { db, sendMail: async () => { throw new Error('down') } })
  assert.equal(response.status, 201)
  assert.equal(db.raw.prepare('SELECT emailed FROM reports').get().emailed, 0)
})

test('reports older than the keeping period are swept', async () => {
  const db = fakeD1()
  const day = 24 * 3600000
  const start = Date.UTC(2026, 0, 1)
  await handle(post(report()), { db, now: () => start })
  await handle(post(report(), '9.9.9.9'), { db, now: () => start + 80 * day })
  await sweep(db, start + (LIMITS.keepDays + 1) * day)
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM reports').get().n, 1)
})

test('the email is plain text and the subject cannot add headers', () => {
  const { subject, text } = reportEmail('FB-AAAAAA', report({ description: 'line one\r\nBcc: x@evil.test\nmore', diagnostics: { a: 1 } }))
  const raw = mimeMessage({ from: 'feedback@yulid.org', to: 'me@example.com', subject, text, id: 'FB-AAAAAA', date: new Date(0) })
  const headers = raw.split('\r\n\r\n')[0]
  assert.ok(!/^Bcc:/m.test(headers))
  assert.match(headers, /^Subject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/m)
  const decoded = Buffer.from(raw.split('\r\n\r\n')[1].replace(/\r\n/g, ''), 'base64').toString('utf8')
  assert.ok(decoded.includes('--- Diagnostics ---'))
  assert.ok(decoded.includes('Bcc: x@evil.test'))
})

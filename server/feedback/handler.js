// Receives problem reports that TheOne users send from the plugin, stores them for a limited time
// and emails the maintainer a copy. Reports arrive only when a user presses Send after reading
// exactly what is sent. Everything that touches Cloudflare is passed in, so this file runs in tests.

export const LIMITS = {
  body: 64 * 1024,
  description: 4000,
  contact: 200,
  diagnostics: 24000,
  reply: 40000,
  perHour: 5,
  emailsPerDay: 30,
  keepDays: 90,
}

const HOUR = 3600000
const DAY = 24 * HOUR
const ID_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  version TEXT NOT NULL,
  lang TEXT NOT NULL,
  description TEXT NOT NULL,
  contact TEXT,
  diagnostics TEXT,
  reply TEXT,
  emailed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS reports_created ON reports(created_at);
CREATE TABLE IF NOT EXISTS hits (
  ip_hash TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS hits_ip ON hits(ip_hash, at);
`

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
})

/** A short id a user can quote in a comment, e.g. FB-7K3QXM. */
export function reportId(random = crypto.getRandomValues(new Uint8Array(6))) {
  return 'FB-' + [...random].map(byte => ID_LETTERS[byte % ID_LETTERS.length]).join('')
}

async function sha256(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

/** The report as sent by the plugin, checked; a string naming the problem when it does not fit. */
export function validateReport(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'INVALID'
  if (value.v !== 1 || value.app !== 'theone') return 'INVALID'
  if (typeof value.version !== 'string' || !/^\d+\.\d+\.\d+([-+][\w.]+)?$/.test(value.version) || value.version.length > 32) return 'INVALID_VERSION'
  if (value.lang !== 'zh' && value.lang !== 'en') return 'INVALID'
  if (typeof value.description !== 'string' || !value.description.trim()) return 'DESCRIPTION_REQUIRED'
  if (value.description.length > LIMITS.description) return 'TOO_LARGE'
  if (value.contact != null && (typeof value.contact !== 'string' || value.contact.length > LIMITS.contact)) return 'INVALID'
  for (const [key, max] of [['diagnostics', LIMITS.diagnostics], ['reply', LIMITS.reply]]) {
    if (value[key] == null) continue
    if (typeof value[key] !== 'object' || Array.isArray(value[key])) return 'INVALID'
    if (JSON.stringify(value[key]).length > max) return 'TOO_LARGE'
  }
  return undefined
}

/** RFC 2047 for a header that may hold any text; line breaks are dropped so it cannot add headers. */
const encodeHeader = text => `=?UTF-8?B?${base64(text.replace(/[\r\n]+/g, ' '))}?=`
function base64(text) {
  let binary = ''
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/** A plain-text email as raw MIME. */
export function mimeMessage({ from, to, subject, text, id, date = new Date() }) {
  const body = base64(text).replace(/.{1,76}/g, line => line + '\r\n')
  return [
    `From: TheOne feedback <${from}>`,
    `To: <${to}>`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${date.toUTCString()}`,
    `Message-ID: <${id}.${date.getTime()}@${from.split('@')[1]}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    body,
  ].join('\r\n')
}

/** The email the maintainer reads: who, what, then the attached details. */
export function reportEmail(id, report) {
  const first = report.description.trim().split('\n')[0].slice(0, 60)
  const subject = `[TheOne ${id}] ${report.version} · ${first}`
  const parts = [
    `${id} · TheOne ${report.version} · ${report.lang}`,
    report.contact ? `Contact: ${report.contact}` : 'Contact: (none)',
    '',
    report.description.trim(),
  ]
  if (report.diagnostics) parts.push('', '--- Diagnostics ---', JSON.stringify(report.diagnostics, null, 2))
  if (report.reply) parts.push('', '--- Reply ---', JSON.stringify(report.reply, null, 2))
  return { subject, text: parts.join('\n') }
}

/**
 * One request. `deps`: { db (D1), sendMail({ subject, text, id }), now(), salt, random? }.
 * POST /v1/reports stores a report and answers { id }; GET /v1/health answers { ok }.
 */
export async function handle(request, deps) {
  const url = new URL(request.url)
  if (url.pathname === '/v1/health' && request.method === 'GET') return json({ ok: true })
  if (url.pathname !== '/v1/reports') return json({ error: 'NOT_FOUND' }, 404)
  if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405)

  const declared = Number(request.headers.get('content-length') ?? 0)
  if (declared > LIMITS.body) return json({ error: 'TOO_LARGE' }, 413)
  const raw = await request.text()
  if (raw.length > LIMITS.body) return json({ error: 'TOO_LARGE' }, 413)
  let report
  try { report = JSON.parse(raw) } catch { return json({ error: 'INVALID' }, 400) }
  const problem = validateReport(report)
  if (problem) return json({ error: problem }, problem === 'TOO_LARGE' ? 413 : 400)

  const { db, now = Date.now } = deps
  const at = now()
  // Only a salted hash of the address is kept, for an hour, to limit how often one sender can post.
  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown'
  const ipHash = (await sha256(`${deps.salt ?? ''}:${ip}`)).slice(0, 32)
  await db.prepare('DELETE FROM hits WHERE at < ?').bind(at - HOUR).run()
  const recent = await db.prepare('SELECT COUNT(*) AS n FROM hits WHERE ip_hash = ? AND at >= ?').bind(ipHash, at - HOUR).first()
  if ((recent?.n ?? 0) >= LIMITS.perHour) return json({ error: 'RATE_LIMITED' }, 429)
  await db.prepare('INSERT INTO hits (ip_hash, at) VALUES (?, ?)').bind(ipHash, at).run()

  const id = reportId(deps.random?.())
  const contact = report.contact?.trim() || null
  await db.prepare('INSERT INTO reports (id, created_at, version, lang, description, contact, diagnostics, reply) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, at, report.version, report.lang, report.description.trim(), contact,
      report.diagnostics ? JSON.stringify(report.diagnostics) : null, report.reply ? JSON.stringify(report.reply) : null).run()

  // A copy by email, at most so many a day; the rest are only stored.
  const dayStart = at - (at % DAY)
  const mailed = await db.prepare('SELECT COUNT(*) AS n FROM reports WHERE emailed = 1 AND created_at >= ?').bind(dayStart).first()
  if ((mailed?.n ?? 0) < LIMITS.emailsPerDay && deps.sendMail) {
    try {
      await deps.sendMail({ id, ...reportEmail(id, { ...report, contact }) })
      await db.prepare('UPDATE reports SET emailed = 1 WHERE id = ?').bind(id).run()
    } catch (error) {
      console.error('feedback email failed', id, error)
    }
  }
  return json({ id }, 201)
}

/** Daily clean-up: reports older than the keeping period, and stale rate-limit entries. */
export async function sweep(db, now = Date.now()) {
  await db.prepare('DELETE FROM reports WHERE created_at < ?').bind(now - LIMITS.keepDays * DAY).run()
  await db.prepare('DELETE FROM hits WHERE at < ?').bind(now - HOUR).run()
}

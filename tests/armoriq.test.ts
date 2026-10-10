import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, sign, verify } from 'node:crypto'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import ArmorAddon, { TopicGuard, scopedAction } from '../src/armoriq.ts'
import { harness, ask, textResponse } from './harness.ts'

// Only the issuer is a fixture. The installed ArmorIQ SDK performs the real
// Ed25519 verification and plan enforcement. These tests are not cloud evidence.
async function issuer() {
  const keys = generateKeyPairSync('ed25519')
  const wrongKeys = generateKeyPairSync('ed25519')
  const state = { badSignature: false, unavailable: false, enforceUnavailable: false, enforced: [] as string[], minted: 0, expiresIn: 300, plans: [] as unknown[] }
  const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    res.setHeader('content-type', 'application/json')
    if (req.url === '/iap/sdk/enforce') {
      if (state.enforceUnavailable) { res.statusCode = 500; res.end('{}'); return }
      const request = JSON.parse(Buffer.concat(chunks).toString())
      state.enforced.push(request.tool)
      const jwt = request.intent_token?.token?.fixture_jwt
      const [header, body, signature] = String(jwt).split('.')
      const valid = signature && verify(null, Buffer.from(`${header}.${body}`), keys.publicKey, Buffer.from(signature, 'base64url'))
      const payload = valid ? JSON.parse(Buffer.from(body, 'base64url').toString()) : null
      const allowed = Boolean(valid && payload.exp > Date.now() / 1000)
      res.end(JSON.stringify({ allowed, enforcementAction: allowed ? 'allow' : 'block', reason: allowed ? 'fixture signed token verified' : 'fixture invalid token' }))
      return
    }
    if (req.url === '/iap/sdk/token') {
      if (state.unavailable) { res.statusCode = 400; res.end('{"success":false}'); return }
      const request = JSON.parse(Buffer.concat(chunks).toString())
      state.plans.push(request.plan)
      state.minted++
      const issuedAt = Date.now() / 1000
      const expiresAt = issuedAt + state.expiresIn
      const header = Buffer.from(JSON.stringify({ alg: 'EdDSA', typ: 'JWT' })).toString('base64url')
      const payload = Buffer.from(JSON.stringify({ exp: expiresAt, plan: request.plan })).toString('base64url')
      const input = `${header}.${payload}`
      const signature = sign(null, Buffer.from(input), state.badSignature ? wrongKeys.privateKey : keys.privateKey).toString('base64url')
      res.end(JSON.stringify({ success: true, intent_reference: `fixture-${state.minted}`, plan_hash: 'fixture',
        token: { issued_at: issuedAt, expires_at: expiresAt, fixture_jwt: `${input}.${signature}` }, jwt_token: `${input}.${signature}` }))
      return
    }
    res.statusCode = 404; res.end('{}')
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address() as { port: number }
  return { state, publicKey, url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) }
}

test('ArmorIQ permits own topic, rejects other topics and arbitrary tools, and verifies issuer signature', async () => {
  const backend = await issuer()
  const guard = new TopicGuard('developer@example.com', { apiKey: 'ak_test_fixture', backendEndpoint: backend.url, iapPublicKey: backend.publicKey }, 300, 'local')
  try {
    assert.equal((await guard.check('topic-a', 'topic-a', 'read')).allowed, true)
    assert.equal((await guard.check('topic-a', 'topic-a', 'write')).allowed, true)
    const cross = await guard.check('topic-a', 'topic-b', 'read')
    assert.equal(cross.allowed, false)
    assert.match(cross.reason!, /tool-not-in-plan/)
    assert.equal((await guard.check('topic-a', 'topic-a', 'unapproved_terminal')).allowed, false)
    assert.equal(backend.state.minted, 1)
    assert.match(JSON.stringify(backend.state.plans), new RegExp(scopedAction('topic-a', 'read')))
    assert.ok(!JSON.stringify(backend.state.plans).includes(scopedAction('topic-b', 'read')))
    backend.state.badSignature = true
    const forged = await guard.check('new-topic', 'new-topic', 'read')
    assert.equal(forged.allowed, false)
    assert.match(forged.reason!, /signature-invalid/)
  } finally { await guard.close(); await backend.close() }
})

test('SDK server mode checks declared actions remotely and fails closed when enforcement is unavailable', async () => {
  const backend = await issuer()
  const guard = new TopicGuard('developer@example.com', { apiKey: 'ak_test_fixture', backendEndpoint: backend.url })
  try {
    assert.equal((await guard.check('a', 'a', 'read')).allowed, true)
    assert.equal((await guard.check('a', 'a', 'write')).allowed, true)
    assert.equal((await guard.check('a', 'b', 'read')).allowed, false)
    assert.equal((await guard.check('a', 'a', 'unapproved_terminal')).allowed, false)
    assert.deepEqual(backend.state.enforced, [scopedAction('a', 'read'), scopedAction('a', 'write')])
    backend.state.enforceUnavailable = true
    const failed = await guard.check('a', 'a', 'read')
    assert.equal(failed.allowed, false)
    assert.equal(failed.action, 'block')
  } finally { await guard.close(); await backend.close() }
})

test('expired plans are renewed, issuer failure denies, and cancellation is preserved', async () => {
  const backend = await issuer()
  const guard = new TopicGuard('developer@example.com', { apiKey: 'ak_test_fixture', backendEndpoint: backend.url, iapPublicKey: backend.publicKey }, 300, 'local')
  try {
    backend.state.expiresIn = -1
    assert.equal((await guard.check('a', 'a', 'read')).allowed, false)
    backend.state.expiresIn = 300
    assert.equal((await guard.check('a', 'a', 'read')).allowed, true)
    backend.state.unavailable = true
    assert.equal((await guard.check('b', 'b', 'read')).allowed, false)
    const signal = AbortSignal.abort(new Error('User cancelled'))
    await assert.rejects(() => guard.check('a', 'a', 'read', signal), /User cancelled/)
  } finally { await guard.close(); await backend.close() }
})

test('real DSH worker saves its own note, blocked cross-topic call has no data effect and reaches the main chat once', async () => {
  const backend = await issuer()
  const root = await mkdtemp(join(tmpdir(), 'theone-armoriq-'))
  const old = { BACKEND_ENDPOINT: process.env.BACKEND_ENDPOINT, ARMORIQ_IAP_PUBLIC_KEY: process.env.ARMORIQ_IAP_PUBLIC_KEY,
    THEONE_TEST_ARMORIQ_KEY: process.env.THEONE_TEST_ARMORIQ_KEY }
  process.env.BACKEND_ENDPOINT = backend.url
  process.env.ARMORIQ_IAP_PUBLIC_KEY = backend.publicKey
  process.env.THEONE_TEST_ARMORIQ_KEY = 'ak_test_fixture'
  const app = await harness(root)
  const dbPath = join(root, 'notes.db')
  try {
    await app.ctx.plugin(ArmorAddon, { userEmail: 'developer@example.com', databasePath: dbPath, apiKeyEnv: 'THEONE_TEST_ARMORIQ_KEY', verificationMode: 'local' })
    let step = 0
    app.model.behavior = async function* () {
      const calls = [
        { operation: 'write', key: 'plan', text: 'Own topic note' },
        { operation: 'read', key: 'secret', topicId: 'ctx_thesis' },
        { operation: 'write', key: 'plan', text: 'Changed other topic', topicId: 'ctx_thesis' },
      ]
      if (step >= calls.length) { yield* textResponse('Saved my note. Cross-topic access was blocked.'); return }
      const id = ToolCallId(`notes-${step}`)
      const args = JSON.stringify(calls[step++])
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name: 'theone_notes', argumentsDelta: args }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'theone_notes', arguments: args } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    }
    const result = await ask(app.gateway, 'Qwen 那个')
    assert.match(result.output, /Cross-topic access was blocked/)
    const db = new DatabaseSync(dbPath)
    try {
      const notes = db.prepare('SELECT topic, text FROM notes').all()
      assert.deepEqual(notes.map(row => ({ ...row })), [{ topic: 'ctx_qwen_9070xt', text: 'Own topic note' }])
      const decisions = db.prepare('SELECT owner, target, allowed, reason FROM decisions ORDER BY id').all()
      assert.deepEqual(decisions.map(row => row.allowed), [1, 0, 0])
      assert.equal(decisions[1].target, 'ctx_thesis')
      assert.match(String(decisions[1].reason), /tool-not-in-plan/)
    } finally { db.close() }
    assert.equal(backend.state.minted, 1)
  } finally {
    await app.close(); await backend.close(); await rm(root, { recursive: true, force: true })
    for (const [key, value] of Object.entries(old)) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
  }
})

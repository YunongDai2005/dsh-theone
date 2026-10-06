import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import { compareReplies, finalReport, routeDigest, scrub, sendReport } from '../src/feedback.ts'
import type { RouteView } from '../src/types.ts'
import { harness, ask, FixtureModel, textResponse } from './harness.ts'

const route = (reason: string, extra: Partial<RouteView> = {}): RouteView => ({ messageId: 'm1', decision: { action: 'SWAP', contextId: 'ctx_a', reason },
  status: 'completed', at: 1_000_000, excerpt: '我的银行卡号是 6222 0000', receipt: { mode: 'llm', model: 'deepseek-v4', elapsedMs: 820 }, ...extra })

test('route digests keep codes and timings, never message text, topic ids or a model’s own words', () => {
  const [model, fallback] = routeDigest([route('用户提到了银行卡和房租'), route('router-fallback:ROUTER_TIMEOUT', { correctedTo: 'ctx_b' })], 1_000_000 + 5 * 60000)
  assert.deepEqual(model, { minutesAgo: 5, action: 'SWAP', reason: 'model', status: 'completed', via: 'llm', model: 'deepseek-v4', ms: 820 })
  assert.equal(fallback.reason, 'router-fallback:ROUTER_TIMEOUT')
  assert.equal(fallback.corrected, true)
  const text = JSON.stringify([model, fallback])
  assert.ok(!text.includes('银行卡') && !text.includes('ctx_a') && !text.includes('6222'))
})

test('reports are scrubbed of keys, emails, addresses and the home folder', () => {
  const value = scrub({ a: 'key sk-abcdefghijklmnopqrstu at /home/ann/.dsh', b: ['mail ann@example.com', 'ip 10.1.2.3'], n: 3 }, '/home/ann')
  assert.deepEqual(value, { a: 'key [REDACTED_KEY] at ~/.dsh', b: ['mail [REDACTED_EMAIL]', 'ip [REDACTED_IP]'], n: 3 })
})

test('garbled signs and the first difference between main chat and the topic session', () => {
  assert.deepEqual(compareReplies('同样的回答', '同样的回答'), { identical: true, main: { chars: 5, replacement: 0, control: 0, repeatedRuns: 0 }, worker: { chars: 5, replacement: 0, control: 0, repeatedRuns: 0 } })
  const garbled = compareReplies('好的��' + '啊'.repeat(25), '好的，没问题')
  assert.equal(garbled.identical, false)
  assert.equal(garbled.firstDifference, 2)
  assert.equal(garbled.main.replacement, 2)
  assert.equal(garbled.main.repeatedRuns, 1)
})

test('a report needs words from the user and a draft TheOne made; sizes are bounded', () => {
  const draft = { v: 1, app: 'theone', version: '0.3.22', diagnostics: { home: '/home/ann/x' } }
  assert.throws(() => finalReport({ draft, description: '  ' }, '0.3.22'), /DESCRIPTION_REQUIRED/)
  assert.throws(() => finalReport({ draft: { ...draft, app: 'x' }, description: 'hi' }, '0.3.22'), /INVALID_INPUT/)
  assert.throws(() => finalReport({ draft: { ...draft, diagnostics: [] }, description: 'hi' }, '0.3.22'), /INVALID_INPUT/)
  assert.throws(() => finalReport({ draft, description: 'x'.repeat(4001) }, '0.3.22'), /TOO_LARGE/)
  // The contact is the user's own and is kept as typed; everything TheOne attached is scrubbed again.
  const report = finalReport({ draft, description: ' 乱码 ', contact: 'ann@example.com', lang: 'zh' }, '0.3.22', '/home/ann')
  assert.deepEqual(report, { v: 1, app: 'theone', version: '0.3.22', lang: 'zh', description: '乱码', contact: 'ann@example.com', diagnostics: { home: '~/x' } })
})

test('sending maps the receiver’s answers to codes the dialog can explain', async () => {
  const report = finalReport({ draft: { v: 1, app: 'theone', version: '0.3.22', diagnostics: {} }, description: 'x' }, '0.3.22')
  const answer = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch
  assert.equal(await sendReport(report, 'https://r.test', answer(201, { id: 'FB-ABC234' })), 'FB-ABC234')
  await assert.rejects(sendReport(report, 'https://r.test', answer(429, {})), /RATE_LIMITED/)
  await assert.rejects(sendReport(report, 'https://r.test', answer(400, {})), /REJECTED/)
  await assert.rejects(sendReport(report, 'https://r.test', answer(201, { id: '<script>' })), /SERVER_ERROR/)
  await assert.rejects(sendReport(report, 'https://r.test', (async () => { throw new TypeError('fetch failed') }) as unknown as typeof fetch), /UNREACHABLE/)
})

test('the feedback endpoint drafts without message text unless asked, compares the reply, and sends only on request', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-feedback-'))
  const received: unknown[] = []
  let status = 201
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', chunk => { body += chunk })
    request.on('end', () => {
      received.push(JSON.parse(body))
      response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(status === 201 ? { id: 'FB-TEST22' } : { error: 'RATE_LIMITED' }))
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const model = new FixtureModel()
  model.behavior = async function* () { yield* textResponse('显卡驱动装好了，密钥 sk-abcdefghijklmnopqrstu 别外传') }
  const app = await harness(root, model, { theoneConfig: { feedbackUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/reports` } })
  try {
    const handler = new HostConnectionService(app.ctx, [], undefined as never).createSharedFetchHandler('/api')
    await new Promise<void>(resolve => setImmediate(resolve))
    const post = async (body: unknown) => {
      const response = await handler.fetch(new Request('http://dsh.internal/api/theone/feedback', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))
      return { status: response.status, body: await response.json() as Record<string, any> }
    }
    const turn = await ask(app.gateway, 'Qwen 显存又爆了，帮我看看')
    const plain = await post({ action: 'draft', messageId: turn.input.id })
    assert.equal(plain.status, 200)
    assert.equal(plain.body.direct, true)
    const drafted = JSON.stringify(plain.body.draft)
    assert.ok(!drafted.includes('显存') && !drafted.includes('显卡驱动'), 'no message or reply text without consent')
    assert.equal(plain.body.draft.reply.comparison.identical, true)
    assert.ok(plain.body.draft.diagnostics.routing.recent.length >= 1)
    assert.equal(received.length, 0, 'drafting sends nothing')

    const withText = await post({ action: 'draft', messageId: turn.input.id, includeReply: true })
    assert.equal(withText.body.draft.reply.message, 'Qwen 显存又爆了，帮我看看')
    assert.match(withText.body.draft.reply.topicSessionReply, /显卡驱动装好了，密钥 \[REDACTED_KEY\]/)
    assert.equal((await post({ action: 'draft', messageId: 'nope' })).body.error, 'UNKNOWN_MESSAGE')

    const sent = await post({ action: 'send', draft: withText.body.draft, description: '回复里有乱码', contact: 'qq 123', lang: 'zh' })
    assert.deepEqual(sent, { status: 200, body: { id: 'FB-TEST22' } })
    assert.equal(received.length, 1)
    const report = received[0] as Record<string, any>
    assert.equal(report.description, '回复里有乱码')
    assert.equal(report.contact, 'qq 123')
    assert.ok(!JSON.stringify(report).includes('sk-abcdefghijklmnopqrstu'))

    status = 429
    assert.deepEqual(await post({ action: 'send', draft: plain.body.draft, description: 'again' }), { status: 502, body: { error: 'RATE_LIMITED' } })
    assert.equal((await post({ action: 'send', draft: plain.body.draft, description: '' })).body.error, 'DESCRIPTION_REQUIRED')
  } finally {
    await app.close(); server.close(); await rm(root, { recursive: true, force: true })
  }
})

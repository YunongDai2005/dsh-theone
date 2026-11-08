import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ToolCallId, ProviderRequestId, type LlmFailure } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { harness, ask, textResponse } from './harness.ts'

for (const failure of [
  { message: 'Invalid request', code: 'HTTP', status: 400 },
  { message: 'Too many requests', code: 'RATE_LIMIT', status: 429, providerRetryAfterMs: 1200, requestId: ProviderRequestId('request-fixture') },
]) test(`main chat preserves a worker's ${failure.status} failure facts`, { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-worker-error-'))
  const app = await harness(root)
  let calls = 0
  app.model.behavior = async function* () {
    calls++
    yield { type: 'finish', reason: { kind: 'error', failure } }
  }
  try {
    const result = await ask(app.gateway, 'Qwen 的配置')
    assert.equal(result.end?.data.reason.kind, 'error')
    if (result.end?.data.reason.kind !== 'error') assert.fail('missing main-chat error')
    assert.equal(result.end.data.reason.error.message, failure.message)
    assert.equal(result.end.data.reason.error.code, failure.code)
    assert.equal(result.end.data.reason.error.status, failure.status)
    assert.equal(result.end.data.reason.error.providerRetryAfterMs, failure.providerRetryAfterMs)
    assert.equal(result.end.data.reason.error.requestId, failure.requestId)
    assert.equal(calls, 1, 'the mirror must not replay the failed worker')
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('a worker failure after an edit retains the edit and tells main chat that an operation ran', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-worker-error-effects-'))
  const app = await harness(root)
  let edits = 0
  app.ctx.tools.register(defineTool({ name: 'edit', description: 'Fixture edit', parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value: string) => [{ type: 'text', text: value }] },
    execute: async () => { edits++; return 'saved' } }))
  app.model.behavior = async function* (options) {
    if (!options.messages.some(message => message.role === 'tool')) {
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: ToolCallId('edit-once'), name: 'edit', arguments: '{}' } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    } else yield { type: 'finish', reason: { kind: 'error', failure: { message: 'Invalid request', code: 'HTTP', status: 400 } } }
  }
  try {
    const result = await ask(app.gateway, 'Qwen 的文件改一下')
    assert.equal(edits, 1)
    if (result.end?.data.reason.kind !== 'error') assert.fail('missing main-chat error')
    assert.equal(result.end.data.reason.error.status, 400)
    assert.match(result.end.data.reason.error.message, /Invalid request/)
    assert.match(result.end.data.reason.error.message, /已.*执行|already.*executed/i)
    assert.ok(result.events.some(event => event.type === 'tool/result'), 'completed tool result remains in main chat')
    assert.equal(app.ctx.theone.store.route(result.input.id)?.status, 'failed')
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('forwarded errors redact credentials and bound text without losing the HTTP status', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-worker-error-private-'))
  const app = await harness(root)
  const secret = 'sk-test-secret-12345678901234567890'
  const failure: LlmFailure = { message: `Invalid request Authorization: Bearer ${secret} oc_sk_fake_for_test_only_123456789 api_key=private-value ${'x'.repeat(5000)}`, code: 'HTTP', status: 400 }
  app.model.behavior = async function* () { yield { type: 'finish', reason: { kind: 'error', failure } } }
  try {
    const result = await ask(app.gateway, 'Qwen 的配置')
    if (result.end?.data.reason.kind !== 'error') assert.fail('missing main-chat error')
    const shown = result.end.data.reason.error
    assert.equal(shown.status, 400)
    assert.match(shown.message, /Invalid request/)
    assert.doesNotMatch(shown.message, /sk-test-secret|oc_sk_fake|private-value/)
    assert.ok(shown.message.length <= 1200)
    app.model.behavior = async function* () { yield* textResponse('恢复正常') }
    assert.equal((await ask(app.gateway, '继续')).output, '恢复正常')
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

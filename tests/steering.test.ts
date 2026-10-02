import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { harness, ask, textResponse } from './harness.ts'

const say = (text: string) => createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })

test('steering sent during a reply reaches the Worker at its next step, in the same turn', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-steer-batch-'))
  const app = await harness(root)
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>()
  const seen: string[] = []
  let calls = 0
  try {
    app.model.behavior = async function* (options) {
      seen.push(options.messages.filter(message => message.role === 'user')
        .map(message => message.content.filter(block => block.type === 'text').map(block => block.text).join('')).join('\n'))
      if (++calls === 1) { entered.resolve(); await release.promise }
      yield* textResponse(calls === 1 ? '第一段回答' : '补充回答')
    }
    const pending = ask(app.gateway, 'Qwen 那个')
    await entered.promise
    app.gateway.steer(say('Qwen 换成 14B'))
    app.gateway.steer(say('Qwen 顺便开量化'))
    release.resolve()
    const result = await pending
    assert.equal(result.end?.data.reason.kind, 'completed', JSON.stringify(result.end))
    assert.equal(result.output, '第一段回答补充回答')
    assert.equal(calls, 2)
    assert.match(seen[1], /Qwen 换成 14B[\s\S]*Qwen 顺便开量化/)
  } finally { release.resolve(); await app.close(); await rm(root, { recursive: true, force: true }) }
})

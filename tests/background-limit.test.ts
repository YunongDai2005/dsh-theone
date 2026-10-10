import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { harness, FixtureModel } from './harness.ts'
import type { Decision } from '../src/types.ts'

const say = (text: string) => createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })

test('at most two topics start in the background, even when several are asked for at the same moment', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-background-limit-'))
  const model = new FixtureModel()
  const release = Promise.withResolvers<void>()
  let started = 0
  model.behavior = async function* () {
    started++
    await release.promise
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
  const app = await harness(root, model)
  try {
    const service = app.ctx.theone as unknown as {
      startBackground(gateway: Agent, message: ReturnType<typeof say>, decision: Decision, receipt: { mode: 'rules' }, signal: AbortSignal): Promise<void>
      background: Map<string, unknown>
    }
    const signal = new AbortController().signal
    await Promise.all(['A', 'B', 'C'].map(name => service.startBackground(app.gateway, say(`话题 ${name}`),
      { action: 'CREATE', title: `话题 ${name}`, reason: 'test' }, { mode: 'rules' }, signal)))
    assert.equal(service.background.size, 2)
    await new Promise(resolve => setTimeout(resolve, 100))
    assert.equal(started, 2)
  } finally { release.resolve(); await app.close(); await rm(root, { recursive: true, force: true }) }
})

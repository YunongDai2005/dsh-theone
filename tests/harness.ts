import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { LlmAdapter, createUserMessage, resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import Persistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionQuery from '@deepseek-ai/dsh-session-query-sqlite'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import TheOne from '../src/index.ts'

export const contextsPath = fileURLToPath(new URL('../fixtures/contexts.json', import.meta.url))

export function* textResponse(text: string): Generator<StreamChunk> {
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield { type: 'text-delta', index: 0, text }
  yield { type: 'block-end', index: 0, block: { type: 'text', text } }
  yield { type: 'usage', usage: { inputTokens: 10, outputTokens: text.length } }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

/** Only the model is simulated. Session, loop, persistence and query are production DSH. */
export class FixtureModel extends LlmAdapter {
  requests: GenerateOptions[] = []
  behavior?: (options: GenerateOptions) => AsyncIterable<StreamChunk>
  override providerRetryPolicy() { return resolveRetryPolicy({ mode: 'normal', maxRetries: 0 }, 'fixture.retry') }
  override async resolveModel(provider: string, model: string) { return { provider, id: model, name: model } }
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    if (this.behavior) { yield* this.behavior(options); return }
    const descriptor = [...options.messages].reverse().find(message => message.role === 'user' && 'source' in message && message.source?.kind === 'theone-context')
    if (!descriptor || !('source' in descriptor) || descriptor.source?.kind !== 'theone-context') throw new Error('Descriptor absent from first worker request')
    yield* textResponse(`模拟回答：${descriptor.source.contextId}`)
  }
}

export async function harness(root: string, model = new FixtureModel(), options: { descriptorPath?: string; compression?: 'none' | 'zstd'; queryPath?: string; routerMode?: 'rules' | 'llm' } = {}) {
  const ctx = new Context()
  try {
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false, includeRuntimeContext: false, personaPrefix: 'Test assistant.' })
    await ctx.plugin(Tools)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(Persistence, { root: join(root, 'sessions'), compression: options.compression ?? 'none' })
    await ctx.plugin(SessionQuery, { path: options.queryPath ?? join(root, 'fts.db') })
    await ctx.plugin(AgentLoop, { agents: [] })
    ctx.llm.registerAdapter(['fixture'], model)
    await ctx.plugin(TheOne, {
      databasePath: join(root, 'contexts.db'), contextsPath: options.descriptorPath ?? contextsPath, gatewayKey: 'test-gateway',
      routerMode: options.routerMode ?? 'rules', workerProvider: 'fixture', workerModel: 'fixture', maxDescriptorChars: 4000, maxResponseChars: 100000,
    })
    const gateway = (await ctx.agents.create({
      sessionId: SessionId(randomUUID()), agentOptions: { provider: 'theone', model: 'gateway' },
    })).agent
    return { ctx, gateway, model, close: () => ctx.fiber.dispose() }
  } catch (error) { await ctx.fiber.dispose(); throw error }
}

export async function ask(agent: Agent, text: string) {
  const input = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })
  const offset = agent.session.snapshotEvents().length
  agent.followup(input)
  await agent.whenIdle()
  const events = agent.session.snapshotEvents().slice(offset)
  const output = events.flatMap(event => event.type === 'assistant/message'
    ? event.data.message.content.flatMap(block => block.type === 'text' ? [block.text] : []) : []).join('')
  const end = events.findLast(event => event.type === 'turn/end')
  return { input, output, events, end }
}

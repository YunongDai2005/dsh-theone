import { LlmAdapter, createUserMessage, resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk, UserMessage } from '@deepseek-ai/dsh-llm'
import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import type TheOne from './index.ts'

/**
 * Main chat's model entries besides plain "TheOne": "TheOne · <model>" still answers through TheOne,
 * with that model doing the routing and the background work.
 */
const VIA = 'via:'
export function viaModel(selection: ModelSelection): string { return `${VIA}${selection.provider}/${selection.model}` }
export function parseVia(id: string | undefined): ModelSelection | undefined {
  if (!id?.startsWith(VIA)) return undefined
  const rest = id.slice(VIA.length)
  const slash = rest.indexOf('/')
  if (slash <= 0 || slash === rest.length - 1 || rest.slice(0, slash) === 'theone') return undefined
  return { provider: rest.slice(0, slash), model: rest.slice(slash + 1) }
}

/** Gateway provider delegates each accepted input to its context's DSH worker. */
export class GatewayAdapter extends LlmAdapter {
  constructor(private readonly service: TheOne) { super() }
  override providerInfo(provider: string) { return { id: provider, name: 'TheOne' } }
  override listModels(provider: string) { return this.service.gatewayModels(provider) }
  override resolveModel(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo> {
    if (model !== 'gateway' && !parseVia(model)) throw new Error('TheOne only exposes its gateway models')
    return this.service.gatewayModelInfo(provider, signal, model)
  }
  override providerRetryPolicy() { return resolveRetryPolicy({ mode: 'normal', maxRetries: 0 }, 'theone.retry') }
  override stream(options: GenerateOptions): AsyncIterable<StreamChunk> { return this.service.answer(options) }
}

/** The Worker receives every message admitted in this gateway step, e.g. several steering messages, as one input. */
/** Main chat's names, as the client sets them per language. */
export const GATEWAY_TITLES = ['TheOne · 主聊天', 'TheOne · Main chat']

/** A round DSH's goal driver queued (source kind "goal", from a plugin TheOne does not depend on). */
export function goalRoundOf(message: { source?: unknown }): string | undefined {
  const source = message.source as { kind?: string; goalId?: unknown } | undefined
  return source?.kind === 'goal' && typeof source.goalId === 'string' ? source.goalId : undefined
}

/** The objective a goal round restates (DSH writes it as a JSON string after "Objective:"). */
export function goalObjective(message: { content: readonly { type: string; text?: string }[] }): string {
  const text = message.content.filter(block => block.type === 'text').map(block => block.text ?? '').join('\n')
  const quoted = text.match(/Objective: ("(?:[^"\\]|\\.)*")/)?.[1]
  try { return quoted ? JSON.parse(quoted) as string : text } catch { return text }
}

export function stepInput(messages: GenerateOptions['messages'], input: UserMessage): UserMessage {
  const batch: UserMessage[] = []
  for (const message of [...messages].reverse()) {
    if (message.role === 'assistant') break
    if (message.role === 'user' && 'source' in message && message.source?.kind === 'user') batch.unshift(message as UserMessage)
  }
  if (batch.length < 2 || batch.at(-1)!.id !== input.id) return input
  return createUserMessage({ source: input.source, content: batch.flatMap((message, index) =>
    index ? [{ type: 'text' as const, text: '\n\n' }, ...message.content] : [...message.content]) })
}

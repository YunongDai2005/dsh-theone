// Probe model for TheOne end-to-end checks. Not a real model: it routes by markers, really calls
// DSH tools, and logs what each session received (tools, tool results) to PROBE_LOG.
import { LlmAdapter, resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import { appendFileSync } from 'node:fs'

export const name = 'probe-models'
export const inject = ['llm']
const LOG = process.env.PROBE_LOG ?? '/tmp/probe.log'
const log = entry => appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n')
const textOf = message => (Array.isArray(message?.content) ? message.content : []).filter(b => b.type === 'text').map(b => b.text).join('\n')

async function* text(t) {
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield { type: 'text-delta', index: 0, text: t }
  yield { type: 'block-end', index: 0, block: { type: 'text', text: t } }
  yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 10 } }
  yield { type: 'finish', reason: { kind: 'stop' } }
}
async function* call(name, args) {
  const id = `call_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  const json = JSON.stringify(args)
  yield { type: 'block-start', index: 0, blockType: 'tool-call' }
  yield { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: json }
  yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: json } }
  yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 10 } }
  yield { type: 'finish', reason: { kind: 'tool-calls' } }
}

class Probe extends LlmAdapter {
  providerInfo(provider) { return { id: provider, name: 'Probe' } }
  providerRetryPolicy() { return resolveRetryPolicy({ mode: 'normal', maxRetries: 0 }, 'probe.retry') }
  async listModels(provider) { return [{ provider, id: 'deepseek-v3.2', name: 'Probe', inputModalities: ['text'] }] }
  async resolveModel(provider, model) {
    return { provider, id: model, name: 'Probe', inputModalities: ['text'], context: { contextWindow: 128000 }, defaultMaxTokens: 8192,
      reasoning: { efforts: [{ id: 'off', name: 'Off' }, { id: 'medium', name: 'Medium' }], defaultEffort: 'medium' } }
  }
  async *stream(options) {
    const system = options.system ?? ''
    if (system.includes('会话话题路由器')) {
      const p = JSON.parse(textOf(options.messages[0]))
      const name = p.text.match(/\[topic:([^\]]+)\]/)?.[1]
      const hit = name && p.contexts.find(c => c.title === name)
      const decision = hit
        ? { action: 'EXISTING', contextId: hit.id, title: null, question: null, reason: 'marker', historyIndependent: null, candidateIds: [], relatedIds: [] }
        : { action: 'CREATE', contextId: null, title: name ?? p.text.slice(0, 30), question: null, reason: 'marker', historyIndependent: true, candidateIds: [], relatedIds: [] }
      yield* text(JSON.stringify(decision)); return
    }
    if (system.includes('整理聊天历史目录')) {
      const p = JSON.parse(textOf(options.messages[0]))
      const first = p.turns[0]?.text ?? ''
      const title = first.match(/\[name:([^\]]+)\]/)?.[1] ?? first.slice(0, 20)
      const reuse = p.ownedContextId ?? p.contexts.find(c => c.title === title)?.id ?? null
      yield* text(JSON.stringify({ topics: [{ contextId: reuse, title, summary: 'probe topic ' + title, entities: [], keywords: ['probe'], lastState: 'probe state', turns: p.turns.map(t => t.seq), groupId: null, groupTitle: 'probe', groupSummary: '' }] }))
      return
    }
    if (options.purpose || system.includes('路由卡片') || system.includes('从用户的更正中学习') || !options.sessionId) { yield* text(options.purpose === 'compaction' ? 'summary' : '{}'); return }
    const messages = options.messages
    const worker = messages.some(m => m.source?.kind === 'theone-context')
    const user = textOf(messages.findLast(m => m.role === 'user' && m.source?.kind === 'user'))
    const tools = (options.tools ?? []).map(t => t.name).sort()
    const last = messages.at(-1)
    const cmd = user.match(/\[run\]\s*(.+)$/s)?.[1]?.trim()
    if (cmd && last?.role !== 'tool') { yield* call('bash', { command: cmd, description: 'probe' }); return }
    const result = last?.role === 'tool' ? JSON.stringify(last.content ?? last).slice(0, 600) : undefined
    log({ session: options.sessionId, kind: worker ? 'topic' : 'native', user: user.slice(0, 80), tools, result })
    yield* text(`PROBE ${worker ? 'topic' : 'native'} tools=${tools.length}${result ? ' result=' + result.slice(0, 200) : ''}`)
  }
}

export function apply(ctx) { ctx.effect(() => ctx.llm.registerAdapter(['deepseek'], new Probe())) }

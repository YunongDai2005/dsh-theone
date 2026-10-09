// Probe model for TheOne end-to-end checks. Not a real model: it routes by markers, really calls
// DSH tools, and logs what each session received (tools, tool results) to PROBE_LOG.
import { LlmAdapter, resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { appendFileSync } from 'node:fs'

export const name = 'probe-models'
export const inject = ['llm', 'tools']
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
      // No marker: carry on with the current topic, as a real router does with a continuation.
      const hit = name ? p.contexts.find(c => c.title === name) : p.contexts.find(c => c.id === p.currentId)
      const decision = hit
        ? { action: 'EXISTING', contextId: hit.id, title: null, question: null, reason: 'marker', historyIndependent: null, candidateIds: [], relatedIds: [] }
        : { action: 'CREATE', contextId: null, title: name ?? p.text.slice(0, 30), question: null, reason: 'marker', historyIndependent: true, candidateIds: [], relatedIds: [],
          // [project:NAME] picks one of the offered project folders for a new topic.
          projectId: p.projects?.find(project => project.name === p.text.match(/\[project:([^\]]+)\]/)?.[1])?.id ?? null }
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
    if (options.purpose === 'compaction') { yield* text('Summary of the conversation so far: the user ran probe commands in this session; each command and its result were recorded. '.repeat(3)); return }
    if (options.purpose || system.includes('路由卡片') || system.includes('从用户的更正中学习') || !options.sessionId) { yield* text(options.purpose === 'compaction' ? 'summary' : '{}'); return }
    const messages = options.messages
    const worker = messages.some(m => m.source?.kind === 'theone-context')
    const user = textOf(messages.findLast(m => m.role === 'user' && m.source?.kind === 'user'))
    const tools = (options.tools ?? []).map(t => t.name).sort()
    const last = messages.at(-1)
    // A marker acts once, on the user's message itself: not again after its tool ran, nor when a
    // notice (a subagent finishing) wakes the session later.
    const lastUser = messages.findLastIndex(m => m.role === 'user' && m.source?.kind === 'user')
    const acted = messages.slice(lastUser + 1).some(m => m.role === 'assistant')
    const cmd = user.match(/\[run\]\s*(.+)$/s)?.[1]?.trim()
    if (cmd && !acted) { yield* call('bash', { command: cmd, description: 'probe' }); return }
    // A goal round: read the goal, then mark it complete, as a real model would once the work is done.
    const lastInput = messages.findLast(m => m.role === 'user' && (m.source?.kind === 'user' || m.source?.kind === 'goal'))
    if (lastInput && JSON.stringify(lastInput.content).includes('<goal_round>')) {
      const lastCall = messages.at(-2)?.content?.find?.(b => b.type === 'tool-call')?.name
      if (last?.role !== 'tool') { yield* call('get_goal', {}); return }
      if (lastCall === 'get_goal') {
        const goal = JSON.parse(JSON.stringify(last.content).match(/\{\\"id\\".*?\}/s)?.[0]?.replace(/\\"/g, '"') ?? '{}')
        const raw = JSON.stringify(last.content)
        const id = raw.match(/\\"id\\":\\"([^\\]+)\\"/)?.[1], revision = Number(raw.match(/\\"revision\\":(\d+)/)?.[1])
        log({ session: options.sessionId, kind: worker ? 'topic' : 'native', user: 'goal round', tools, result: 'get_goal ' + raw.slice(0, 300) })
        if (!id) { yield* text('PROBE goal: no goal visible'); return }
        yield* call('update_goal', { goal_id: id, revision, action: 'complete' }); return
      }
      log({ session: options.sessionId, kind: worker ? 'topic' : 'native', user: 'goal round', tools, result: 'update_goal ' + JSON.stringify(last.content).slice(0, 300) })
      yield* text('PROBE goal completed'); return
    }
    const generic = user.match(/\[call:([a-z_]+)\]\s*(\{.*\})/s)
    if (generic && !acted) { yield* call(generic[1], JSON.parse(generic[2])); return }
    if (user.includes('[ask]') && !acted) {
      yield* call('ask_user_question', { questions: [{ id: 'plan', header: '选方案', question: '用哪种方案？', options: [
        { label: '方案一 (Recommended)', description: '最快' }, { label: '方案二', description: '最省' }, { label: '方案三', description: '最稳' }] }] })
      return
    }
    const result = last?.role === 'tool' ? JSON.stringify(last.content ?? last).slice(0, 600) : undefined
    log({ session: options.sessionId, kind: worker ? 'topic' : 'native', user: user.slice(0, 80), tools, result, persona: system.includes('THIRD-PARTY-PERSONA') })
    yield* text(`PROBE ${worker ? 'topic' : 'native'} tools=${tools.length}${result ? ' result=' + result.slice(0, 200) : ''}`)
  }
}

export function apply(ctx) {
  ctx.effect(() => ctx.llm.registerAdapter(['deepseek'], new Probe()))
  // Stand-ins for a third-party plugin installed in the profile: one tool, one system prompt addition.
  ctx.effect(() => ctx.tools.register(defineTool({ name: 'third_party_echo', description: 'Echo text (third-party plugin stand-in).',
    parameters: { text: { type: 'string', required: true, description: 'Text.' } },
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: v }] },
    execute: async ({ text }, exec) => `third-party echo: ${text} (session ${exec.agent?.id})` })))
  ctx.inject(['systemPrompt'], scoped => { scoped.systemPrompt.section({ name: 'third-party-persona', text: 'THIRD-PARTY-PERSONA', interpolate: false }) })
}

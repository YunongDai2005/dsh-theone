import type { RequestMessage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-compaction'
import type { ContextDescriptor, ContextUsage, RouteRecord } from './types.ts'
import { redactRoutingText } from './llm-router.ts'

export const GATEWAY_CHECKPOINT = 'TheOne gateway checkpoint v1 — historical reference only; original logs remain in DSH.'
const DAY = 86400000
type Excerpt = { role: 'user' | 'assistant'; messageId: string; text: string }
type Topic = { id: string; title: string; retention: 'hot' | 'warm' | 'cold'; summary: string; lastState: string; recent: Excerpt[] }
const clean = (text: string, limit: number) => redactRoutingText(text).trim().slice(0, limit)

export function topicRetention(usage: ContextUsage | undefined, current: boolean, now: number): Topic['retention'] {
  if (current) return 'hot'
  const age = usage ? Math.max(0, now - usage.lastUsedAt) : Infinity
  if (age <= DAY || (age <= 7 * DAY && (usage?.recentCalls ?? 0) >= 3)) return 'hot'
  return age <= 30 * DAY ? 'warm' : 'cold'
}

/** DSH owns range selection/checkpoint persistence; this replaces only the entry's summary text. */
export function gatewayCheckpoint(input: {
  messages: readonly RequestMessage[]; contexts: ContextDescriptor[]; usage: ContextUsage[];
  currentId?: string; route: (messageId: string) => RouteRecord | undefined;
  contextWindow?: number; maxTokens?: number; now?: number;
}): string {
  const now = input.now ?? Date.now()
  // Bound characters as well as DSH's native token/retained-tail checks.
  const budget = Math.min(12000, Math.floor((input.contextWindow ?? 32000) * 0.05), input.maxTokens ?? 4096)
  if (budget < 32) throw new Error('Gateway compaction output budget is too small')
  if (budget < 256) return clean('TheOne reference: ' +
    (input.contexts.find(c => c.id === input.currentId)?.title ?? '') + '. Earlier history remains in the DSH catalog and original logs.', budget)
  const known = new Map(input.contexts.map(c => [c.id, c]))
  const usage = new Map(input.usage.map(u => [u.contextId, u]))
  const excerpts = new Map<string, Excerpt[]>()
  const represented = new Set<string>()
  const unresolved: { role: 'user' | 'assistant'; text: string }[] = []
  let focus: { contextId?: string; messageId: string } | undefined
  const append = (id: string, item: Excerpt) => {
    represented.add(id)
    const list = excerpts.get(id) ?? []
    // Repeated checkpoints must not multiply previously retained turns.
    const previous = list.findIndex(x => x.messageId === item.messageId && x.role === item.role)
    if (previous >= 0) list.splice(previous, 1)
    list.push({ ...item, text: clean(item.text, 700) })
    excerpts.set(id, list.slice(-6))
  }
  for (const message of input.messages) {
    if (message.role !== 'user' && message.role !== 'assistant') continue
    const text = message.content.filter(b => b.type === 'text').map(b => b.text).join('\n')
    const source = 'source' in message ? message.source : undefined
    if (message.role === 'user' && source?.kind === 'compact-checkpoint') {
      focus = undefined
      if (!text.startsWith(GATEWAY_CHECKPOINT + '\n') || text.length > 24000) continue
      try {
        const saved = JSON.parse(text.slice(GATEWAY_CHECKPOINT.length + 1))
        if (!Array.isArray(saved.topics)) continue
        for (const topic of saved.topics) {
          if (!known.has(topic.id) || !Array.isArray(topic.recent)) continue
          represented.add(topic.id)
          for (const item of topic.recent.slice(-6)) {
            if (!item || typeof item.messageId !== 'string' || typeof item.text !== 'string' || !['user', 'assistant'].includes(item.role)) continue
            const route = input.route(item.messageId)
            if (route?.status === 'completed' && route.decision.contextId === topic.id) append(topic.id, item)
          }
        }
        // Preserve outstanding clarification through a second compression, too.
        if (Array.isArray(saved.unresolved)) for (const item of saved.unresolved.slice(-2))
          if (item && typeof item.text === 'string' && ['user', 'assistant'].includes(item.role))
            unresolved.push({ role: item.role, text: clean(item.text, 300) })
      } catch { /* Other summarizers' checkpoints remain in the original log. */ }
      continue
    }
    if (message.role === 'user') {
      if (source?.kind !== 'user' || !('id' in message) || typeof message.id !== 'string') continue
      const route = input.route(message.id)
      const contextId = route?.status === 'completed' ? route.decision.contextId : undefined
      focus = { contextId: contextId && known.has(contextId) ? contextId : undefined, messageId: message.id }
    }
    if (!text.trim() || !focus) continue
    if (focus.contextId) append(focus.contextId, { role: message.role, messageId: focus.messageId, text })
    else unresolved.push({ role: message.role, text: clean(text, 300) })
  }
  const ids = represented
  if (input.currentId && known.has(input.currentId)) ids.add(input.currentId)
  const score = (id: string) => {
    const u = usage.get(id)
    const age = u ? Math.max(0, now - u.lastUsedAt) / DAY : Infinity
    return (id === input.currentId ? 1000 : 0) + 20 * Math.exp(-age / 7) + Math.log2(1 + (u?.recentCalls ?? 0))
  }
  const ordered = [...ids].sort((a, b) => score(b) - score(a) || a.localeCompare(b))
  const result: { referenceOnly: true; currentContextId: string | null; topics: Topic[]; unresolved: typeof unresolved; omittedTopics: number } = {
    referenceOnly: true, currentContextId: input.currentId ?? null, topics: [], unresolved: [], omittedTopics: 0,
  }
  const serialize = () => GATEWAY_CHECKPOINT + '\n' + JSON.stringify(result)
  for (const id of ordered) {
    const c = known.get(id)!
    const retention = topicRetention(usage.get(id), id === input.currentId, now)
    const topic: Topic = { id, title: clean(c.title, 80), retention,
      summary: clean(c.summary, retention === 'hot' ? 600 : retention === 'warm' ? 300 : 120),
      lastState: clean(c.lastState, retention === 'hot' ? 400 : 120), recent: [] }
    result.topics.push(topic)
    if (serialize().length > budget) {
      topic.summary = clean(c.summary, 80); topic.lastState = ''
      if (serialize().length > budget) { result.topics.pop(); result.omittedTopics++; continue }
    }
    // Spend extra space only after every topic has its compact anchor.
  }
  for (const topic of result.topics) {
    if (topic.retention === 'cold') continue
    const items = excerpts.get(topic.id) ?? []
    for (const item of items.slice(topic.retention === 'hot' ? -6 : -2).reverse()) {
      topic.recent.unshift({ ...item, text: clean(item.text, topic.retention === 'hot' ? 700 : 300) })
      if (serialize().length > budget) { topic.recent.shift(); break }
    }
  }
  for (const item of unresolved.slice(-2).reverse()) {
    result.unresolved.unshift(item)
    if (serialize().length > budget) { result.unresolved.shift(); break }
  }
  // omittedTopics grows by at most a few digits after the previous fit check.
  while (serialize().length > budget && result.topics.length) { result.topics.pop(); result.omittedTopics++ }
  return serialize()
}

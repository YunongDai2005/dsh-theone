import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { buildSessionEventSearchDocuments, filterSessionEventDocuments } from '@deepseek-ai/dsh-session-query'
import type { SessionEventWindow } from '@deepseek-ai/dsh-session-query'
import type { RecentMessage } from './llm-router.ts'
import type { SourceRange } from './types.ts'
import type TheOne from './service.ts'

/** This main chat's recent text turns, each attributed to the topic it was routed to. */
export function recentMainChat(service: TheOne, gateway: Agent, inputId: string, withheld: (topicId: string) => boolean): RecentMessage[] {
  const messages: RecentMessage[] = []
  let topic: string | undefined
  for (const event of gateway.session.snapshotEvents()) {
    if (event.type === 'user/message' && event.data.source.kind === 'user') {
      if (event.data.id === inputId) break
      topic = service.store.route(event.data.id)?.decision.contextId ?? topic
      if (topic && withheld(topic)) continue
      messages.push({ role: 'user', text: event.data.content.filter(block => block.type === 'text').map(block => block.text).join('\n') })
    } else if (event.type === 'assistant/message' && !(topic && withheld(topic))) {
      messages.push({ role: 'assistant', text: event.data.message.content.filter(block => block.type === 'text').map(block => block.text).join('\n') })
    }
  }
  return messages.filter(message => message.text.trim()).slice(-12)
}

/** Recover bounded routing context from DSH references after the Gateway is rebuilt. */
export async function recentMessages(service: TheOne, agent: Agent, inputId: string, signal: AbortSignal): Promise<RecentMessage[]> {
  const project = (events: readonly SessionEvent[]) => events.flatMap<RecentMessage>(event => {
    if (event.type === 'user/message' && event.data.source.kind === 'user' && event.data.id !== inputId) {
      return [{ role: 'user', text: event.data.content.filter(block => block.type === 'text').map(block => block.text).join('\n') }]
    }
    if (event.type === 'assistant/message') return [{ role: 'assistant', text: event.data.message.content.filter(block => block.type === 'text').map(block => block.text).join('\n') }]
    return []
  }).filter(message => message.text.trim()).slice(-12)
  let recent = project(agent.session.snapshotEvents())
  if (recent.length >= 12) return recent
  for (const id of service.store.recentGatewayIds(service.config.gatewayKey, agent.id)) {
    signal.throwIfAborted()
    try {
      const log = await service.ctx.sessionQuery.readSession(SessionId(id))
      signal.throwIfAborted()
      recent = [...project(log.events), ...recent].slice(-12)
    } catch { signal.throwIfAborted() /* A corrupt old Gateway cannot block current input. */ }
    if (recent.length >= 12) break
  }
  return recent
}

/** Literal Unicode search over reviewed ranges; failures are isolated per source. */
export async function searchHistoryDetailed(service: TheOne, contextId: string, query: string, limit = 3, signal?: AbortSignal) {
  signal?.throwIfAborted()
  if (!service.store.contexts().some(context => context.id === contextId)) throw new Error('Unknown Context')
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) throw new Error('History limit must be 1–10')
  if (!query.trim() || query.length > 256) throw new Error('History query must contain 1–256 characters')
  const windows: SessionEventWindow[] = []
  const documents: { sessionId: string; seq: number; text: string }[] = []
  const failures: { sessionId: string; code: string }[] = []
  const groups = new Map<string, SourceRange[]>()
  for (const source of service.store.sourceRanges(contextId)) {
    groups.set(source.sessionId, [...groups.get(source.sessionId) ?? [], source])
  }
  for (const [sessionId, sources] of groups) {
    signal?.throwIfAborted()
    if (sources.every(source => source.kind === 'unscoped')) {
      failures.push({ sessionId, code: 'HISTORY_RANGE_REQUIRED' })
      continue
    }
    try {
      // One consistent observation per Session, even with many disjoint ranges.
      // Reuse DSH's semantic projection and literal Unicode matching, bypassing FTS.
      const log = await service.ctx.sessionQuery.readSession(SessionId(sessionId))
      signal?.throwIfAborted()
      const projected = buildSessionEventSearchDocuments(SessionId(sessionId), log.events)
      const hits = filterSessionEventDocuments(projected, [
        { kind: 'text', text: query.trim() },
      ])
      for (const hit of hits) {
        if (windows.length >= limit) break
        // Another topic's news delivered as reference is not this topic's own history.
        const hitEvent = log.events.find(event => event.seq === hit.seq)
        if (hitEvent?.type === 'user/message' && hitEvent.data.source.kind === 'theone-links') continue
        const scope = sources.find(source => source.kind === 'worker' ||
          (source.kind === 'bounded' && hit.seq >= source.startSeq && hit.seq <= source.endSeq))
        if (!scope) continue
        const index = log.events.findIndex(event => event.seq === hit.seq)
        const target = log.events[index]
        const events = log.events.slice(Math.max(0, index - 1), index + 2).filter(event =>
          scope.kind === 'worker' || (scope.kind === 'bounded' && event.seq >= scope.startSeq && event.seq <= scope.endSeq))
        // Never expose neighbors outside the reviewed range, including at its edges.
        windows.push({ session: log.session, inheritedEventCount: log.inheritedEventCount,
          target, events, startSeq: events[0].seq, endSeq: events.at(-1)!.seq })
        // Projection requires a complete contiguous log. Only export documents inside this clipped window.
        for (const document of projected) {
          if (events.some(event => event.seq === document.seq) && !documents.some(d => d.sessionId === sessionId && d.seq === document.seq)) {
            documents.push({ sessionId, seq: document.seq, text: document.text })
          }
        }
      }
    } catch (error) {
      signal?.throwIfAborted()
      // Error messages may include private conversation text. Return only codes.
      failures.push({ sessionId, code: typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : 'HISTORY_SOURCE_UNREADABLE' })
    }
  }
  return { windows, documents, failures, partial: failures.length > 0 }
}

/** Convenience API. Use searchHistoryDetailed when source diagnostics matter. */
export async function searchHistory(service: TheOne, contextId: string, query: string, limit = 3) {
  return (await searchHistoryDetailed(service, contextId, query, limit)).windows
}

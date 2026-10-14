import type { Agent, ModelSelection } from '@deepseek-ai/dsh-agent'
import { evidenceEvents, type EvidenceEvent, type FactCandidate, type FactView } from './facts.ts'
import { applyExtraction, EXTRACT_PROMPT, extractionPayload, factCandidates, factDelivery, ownFactsText } from './fact-flow.ts'
import { CARD_PROMPT, cardPayload, parseCard } from './topic-memory.ts'
import { modelJson } from './model-json.ts'
import { redactRoutingText, topicTerms } from './routing-policy.ts'
import { redactDescriptor, TERMS_PROMPT } from './service-text.ts'
import type { RecentMessage } from './llm-router.ts'
import type { StoredContext } from './types.ts'
import type TheOne from './service.ts'

/** Queue an extraction of the turn that just ended in `worker`'s topic. */
export function queueExtraction(service: TheOne, worker: Agent, contextId: string): void {
  // What the topic knew when the turn ended: a later write to the same fact makes this one stale.
  const events = evidenceEvents(worker.session.snapshotEvents())
  const base = service.store.facts(contextId, true)
  const previous = service.extractions.get(contextId) ?? Promise.resolve()
  const job = previous.then(() => extractFacts(service, worker.id, contextId, events, base)).catch(error => {
    console.warn('TheOne could not extract facts from the last turn.', error)
  }).finally(() => { if (service.extractions.get(contextId) === job) service.extractions.delete(contextId) })
  service.extractions.set(contextId, job)
}

/** Queue a routing card for this topic, after any extraction already queued for it. */
export function queueCard(service: TheOne, worker: Agent, contextId: string): void {
  const events = evidenceEvents(worker.session.snapshotEvents())
  const previous = service.extractions.get(contextId) ?? Promise.resolve()
  const job = previous.then(() => writeCard(service, contextId, events)).catch(error => {
    console.warn('TheOne could not update a topic card.', error)
  }).finally(() => { if (service.extractions.get(contextId) === job) service.extractions.delete(contextId) })
  service.extractions.set(contextId, job)
}

export async function writeCard(service: TheOne, contextId: string, events: EvidenceEvent[]): Promise<void> {
  const topic = service.store.contexts().find(context => context.id === contextId)
  if (!topic) return
  const payload = cardPayload({ ...topic, summary: redactDescriptor(topic.summary) }, events.map(event => ({ speaker: event.speaker, text: redactDescriptor(event.text) })))
  if (!payload) return
  const selection = service.backingModel()
  let reasoningEffort: ModelSelection['reasoningEffort']
  try { reasoningEffort = (await service.ctx.llm.resolveModelInfo(selection.provider, selection.model)).reasoning?.efforts.find(effort => effort.id === 'off')?.id } catch { /* Default effort. */ }
  const card = parseCard(await modelJson(service.ctx.llm, selection, CARD_PROMPT, payload, undefined, { maxTokens: 800, timeoutMs: 30000, ...(reasoningEffort ? { reasoningEffort } : {}) }),
    text => redactDescriptor(redactRoutingText(text)))
  if (card) service.store.applyCard(contextId, card)
}

export async function extractFacts(service: TheOne, sessionId: string, contextId: string, events: EvidenceEvent[], base: FactView[]): Promise<void> {
  const payload = extractionPayload(events, base)
  if (!payload) return
  const selection = service.backingModel()
  let reasoningEffort: ModelSelection['reasoningEffort']
  try { reasoningEffort = (await service.ctx.llm.resolveModelInfo(selection.provider, selection.model)).reasoning?.efforts.find(effort => effort.id === 'off')?.id } catch { /* Default effort. */ }
  const items = await modelJson(service.ctx.llm, selection, EXTRACT_PROMPT, payload, undefined, { maxTokens: 1024, timeoutMs: 30000, ...(reasoningEffort ? { reasoningEffort } : {}) })
  applyExtraction(service.store, { sessionId, contextId, events, base, items })
}

/**
 * The user moved a message to another topic: remember it, and teach both topics. The right topic
 * gains the message's distinctive terms and the wrong one loses them; `weight` is lower for
 * implicit signals. The model picks the terms in one small call; plain extraction is the fallback.
 */
export function applyCorrection(service: TheOne, messageId: string, contextId: string, text?: string, weight = 1, record = true): void {
  const route = service.store.route(messageId)
  if (record) service.store.correctRoute(messageId, contextId)
  // The wrong topic's work on it no longer counts as its own.
  if (record && service.store.topicRun(messageId)?.contextId !== contextId) service.store.endTopicRun(messageId, 'moved')
  const wrongId = route?.decision.contextId !== contextId ? route?.decision.contextId : undefined
  const source = text ?? service.store.recentRoutes(service.config.gatewayKey, 200).find(item => item.messageId === messageId)?.excerpt ?? ''
  if (!source.trim()) return
  const contexts = service.store.contexts()
  const right = contexts.find(context => context.id === contextId)
  const wrong = contexts.find(context => context.id === wrongId)
  // A term another topic is named by stays with it; teaching it here would only make both match.
  const owned = new Set(contexts.filter(context => context.id !== contextId).flatMap(context => [context.title, ...context.entities]).map(term => term.toLowerCase()))
  const usable = (terms: string[]) => terms.filter(term => !owned.has(term.toLowerCase()))
  const learn = (terms: string[]) => {
    if (!terms.length || !right) return
    service.store.learnTerms(contextId, terms, weight)
    // Only an explicit correction says the first topic was wrong; a hint only strengthens the other.
    if (wrong && record) service.store.learnTerms(wrong.id, terms, -weight)
  }
  const picked = service.router && right ? pickTerms(service, source, right, wrong).catch(() => [] as string[]) : Promise.resolve([] as string[])
  service.learning = service.learning.then(() => picked).then(terms => {
    // Terms must appear in the message: the model chooses, it does not invent.
    const chosen = usable(terms.filter(term => source.toLowerCase().includes(term.toLowerCase())))
    learn(chosen.length ? chosen : usable(topicTerms(source)))
  }).catch(() => {})
}

/** Ask the selected model, thinking off, for the few terms that tie a message to its topic. */
export async function pickTerms(service: TheOne, text: string, right: StoredContext, wrong?: StoredContext): Promise<string[]> {
  const selection = service.backingModel()
  let reasoningEffort: ModelSelection['reasoningEffort']
  try { reasoningEffort = (await service.ctx.llm.resolveModelInfo(selection.provider, selection.model)).reasoning?.efforts.find(effort => effort.id === 'off')?.id } catch { /* Default effort. */ }
  const value = await modelJson(service.ctx.llm, selection, TERMS_PROMPT,
    { message: redactRoutingText(text).slice(0, 600), rightTopic: { title: right.title, summary: right.summary.slice(0, 300) },
      ...(wrong ? { wrongTopic: { title: wrong.title, summary: wrong.summary.slice(0, 300) } } : {}) },
    undefined, { maxTokens: 256, timeoutMs: 20000, ...(reasoningEffort ? { reasoningEffort } : {}) })
  if (!Array.isArray(value)) return []
  return value.filter((term): term is string => typeof term === 'string' && term.trim().length >= 2 && term.trim().length <= 24).map(term => term.trim()).slice(0, 4)
}

/** Confirmed facts this message might use (see fact-flow). */
export function topicFactCandidates(service: TheOne, text: string, recent: RecentMessage[], currentId?: string): FactCandidate[] {
  return factCandidates(service.store, service.linkScope, text, recent.map(message => message.text), currentId)
}

/** What a topic is told about facts before its Worker answers (see fact-flow). */
export function topicFactDelivery(service: TheOne, contextId: string, imports: string[], inputId: string) {
  return factDelivery(service.store, service.linkScope, contextId, imports, inputId)
}

/** The topic's own recorded facts for its Worker's descriptor; empty unless shared facts are on. */
export function topicOwnFacts(service: TheOne, contextId: string): string {
  return service.config.factLinks ? ownFactsText(service.store, contextId) : ''
}

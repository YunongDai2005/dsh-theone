#!/usr/bin/env node
// Shared facts, measured: replay InterleaveBench v1 sessions and, at each probe, ask topic B about a
// fact of topic A with five kinds of context. The facts strategy runs TheOne's own code from dist/:
// extraction after every turn, candidates offered to routing, the router's imports, delivery checks
// and version notices, and the briefing text the Worker would receive.
//
//   single   the whole chat, every topic in one history (no routing at all)
//   own      only topic B's history (routing without any sharing)
//   summary  B's history plus a model-written summary of topic A up to that moment
//   facts    B's history plus what TheOne's shared facts deliver
//   oracle   B's history plus the true value (the ceiling)
//
// Topics follow the gold labels, so routing mistakes do not blur the comparison; routing is measured
// separately, with and without facts offered, on the probes and on a sample of turns.
//
//   node eval/run-facts.mjs                       (needs DEEPSEEK_API_KEY and `npm run build`)
//   node eval/run-facts.mjs --dry-run --limit 2   (fake model, costs nothing)
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { ContextStore } from '../dist/store.js'
import { matchText, states } from '../dist/facts.js'
import { applyExtraction, EXTRACT_PROMPT, extractionPayload, factCandidates, factDelivery } from '../dist/fact-flow.js'
import { buildBriefing } from '../dist/linkage.js'
import { routingPayload, routingPrompt, validateRoutingDecision } from '../dist/llm-router.js'
import { createClient } from './lib/llm.mjs'
import { ANSWER_SYSTEM, SUMMARY_SYSTEM } from './lib/prompts.mjs'
import { factState, rng } from './lib/schedule.mjs'
import { readSessions } from './run-router.mjs'

const here = dirname(fileURLToPath(import.meta.url))
export const STRATEGIES = ['single', 'own', 'summary', 'facts', 'oracle']
const SCOPE = 'auto'
const UNDECIDED = /未确定|未定|没定|还没(有)?(确定|定)|不确定|undecided|not (yet )?(settled|decided)|unsettled|unknown/i

const numbers = text => matchText(text).match(/\d+(?:\.\d+)?/g) ?? []
/** Does `text` say `value`? The plugin's matching, with whole numbers only: "7000" does not say 700. */
const says = (text, value) => {
  const have = new Set(numbers(text))
  return numbers(value).every(number => have.has(number)) && states(text, value)
}
/** Both say the same value: so "800 元" and "800" match, "800" and "8000" do not. */
const same = (a, b) => says(a, b) && says(b, a)

/** Values of one thread's facts as they stood right after turn `at`: current, proposed only, and superseded. */
function valuesAt(timeline, thread, at) {
  const events = timeline.filter(event => event.thread === thread && event.turn <= at && !event.miss)
  const keys = [...new Set(events.map(event => event.key))]
  const current = keys.map(key => factState(timeline, thread, key, at)).filter(value => value != null)
  const confirmed = events.filter(event => event.status === 'confirmed').map(event => event.value).filter(value => !current.some(item => same(item, value)))
  const proposed = events.filter(event => event.kind === 'propose').map(event => event.value).filter(value => !current.some(item => same(item, value)) && !confirmed.some(item => same(item, value)))
  return { current, stale: confirmed, proposed }
}

/** One delivered line: does it carry the value as it stands, a superseded one, or a mere proposal? */
export function deliveryVerdict(line, { titles, timeline, at }) {
  const thread = titles.get(line.match(/【(.+?)】/)?.[1])
  const value = (line.match(/ = (.+?)（第/) ?? line.match(/→ (.+?)（第/) ?? line.match(/重新确认为 (.+?)（第/))?.[1]
  if (value === undefined) return 'withdrawn'
  if (!thread) return 'unknown'
  const values = valuesAt(timeline, thread, at)
  if (values.current.some(item => same(item, value))) return 'current'
  if (values.proposed.some(item => same(item, value))) return 'proposal'
  if (values.stale.some(item => same(item, value))) return 'stale'
  return 'unknown'
}

/** Score one answer: correct, or which way it went wrong (an old value, a proposal, "undecided", other). */
export function judgeAnswer(answer, probe, timeline) {
  const said = value => says(answer, value)
  // A decoy contained in the right value ("120" in "1200") cannot be told apart and is not held against it.
  const decoy = probe.decoys.find(value => said(value) && !(probe.gold != null && says(probe.gold, value)))
  const undecided = UNDECIDED.test(answer)
  if (probe.gold == null ? undecided && !decoy : said(probe.gold) && !decoy) return 'correct'
  if (decoy) return timeline.some(event => event.thread === probe.source && event.key === probe.key && event.status === 'confirmed' && event.turn <= probe.after && same(event.value, decoy)) ? 'stale' : 'proposal'
  return undecided ? 'missing' : 'wrong'
}

/** Replay one session; returns result rows (kind: answer, route, delivery, session). */
export async function runSession(session, { client, strategies = STRATEGIES, routeTurns = 6 }) {
  const id = session.session_id
  const threads = new Map(session.threads.map(thread => [thread.id, thread]))
  const titles = new Map(session.threads.map(thread => [thread.title, thread.id]))
  const timeline = session.timeline ?? []
  const contexts = session.threads.map(thread => ({ id: thread.id, title: thread.title, summary: thread.description, entities: [], keywords: [], lastState: '' }))
  const store = new ContextStore(':memory:')
  store.seed(contexts)
  const withFacts = strategies.includes('facts')
  const events = new Map(session.threads.map(thread => [thread.id, []]))
  const chat = []
  const probes = new Map()
  for (const probe of session.probes ?? []) probes.set(probe.after, [...probes.get(probe.after) ?? [], probe])
  const random = rng(session.turns.length * 7 + id.length)
  const spent = { extract: 0, route: 0, summary: 0, answer: 0 }
  const rows = []
  let current, checked = 0, seq = 0

  const route = async (input, tag) => {
    try {
      const payload = routingPayload(input)
      const answer = await client.complete({ system: routingPrompt(payload), user: JSON.stringify(payload), maxTokens: 2048, json: true, details: true, tag })
      spent.route += answer.usage?.input ?? 0
      const decision = validateRoutingDecision(answer.value, input)
      return { pred: decision.action === 'CREATE' ? 'CREATE' : decision.action === 'CLARIFY' ? 'CLARIFY' : decision.contextId, imports: decision.imports ?? [] }
    } catch (error) { return { pred: 'ERROR', imports: [], error: String(error.code ?? error.message).slice(0, 120) } }
  }
  // The same request routed with the candidates offered and without: the topic chosen must not change.
  const routeBoth = async (text, recent, gold, at, tag) => {
    const input = { text, contexts, currentId: current, recent: recent.slice(-12) }
    const offered = factCandidates(store, SCOPE, text, input.recent.map(message => message.text), current)
    const [plain, offeredRoute] = await Promise.all([route(input, `route:${tag}:plain`), offered.length ? route({ ...input, facts: offered }, `route:${tag}:facts`) : undefined])
    const withRoute = offeredRoute ?? plain
    rows.push({ kind: 'route', session_id: id, at, item: tag, gold, offered: offered.length, without: plain.pred, with: withRoute.pred, imports: withRoute.imports.length,
      ...(plain.error || withRoute.error ? { error: plain.error ?? withRoute.error } : {}) })
    return withRoute
  }
  const conversation = list => list.flatMap(event => [{ role: event.speaker, text: event.text }])

  const answerProbe = async probe => {
    const reader = probe.thread, source = threads.get(probe.source)
    const own = conversation(events.get(reader))
    const zh = session.lang === 'zh'
    const notes = {}
    let delivery
    if (strategies.includes('summary')) {
      const exchanges = session.turns.filter(turn => turn.gold.thread === probe.source && turn.i <= probe.after).map(turn => ({ user: turn.text, assistant: turn.assistant }))
      const answer = await client.complete({ system: SUMMARY_SYSTEM, user: JSON.stringify({ title: source.title, messages: exchanges }), maxTokens: 400, details: true, tag: `summary:${id}:${probe.source}:${probe.after}` })
      spent.summary += answer.usage?.input ?? 0
      notes.summary = `${zh ? '其他话题的摘要（引用资料）' : 'Summary of another topic (reference)'}：\n【${source.title}】${String(answer.value).trim()}`
    }
    if (withFacts) {
      const routed = await routeBoth(probe.question, chat, reader, probe.after, `${probe.id}`)
      delivery = factDelivery(store, SCOPE, reader, routed.imports, probe.id)
      const briefing = buildBriefing(store, { context: store.contexts().find(context => context.id === reader), related: [], recent: [], notices: delivery.notices, facts: delivery.facts })
      notes.facts = briefing?.text ?? ''
      if (briefing) delivery.commit()
      for (const line of [...delivery.notices, ...delivery.facts])
        rows.push({ kind: 'delivery', session_id: id, probe: probe.id, at: probe.after, reader, notice: delivery.notices.includes(line), verdict: deliveryVerdict(line, { titles, timeline, at: probe.after }), line })
    }
    const label = threads.get(probe.source).facts.find(fact => fact.key === probe.key)?.key ?? probe.key
    notes.oracle = `【${source.title}】${label}：${probe.gold ?? (zh ? '未确定' : 'undecided')}`
    const contextFor = {
      single: { notes: '', conversation: chat.slice() },
      own: { notes: '', conversation: own },
      summary: { notes: notes.summary, conversation: own },
      facts: { notes: notes.facts, conversation: own },
      oracle: { notes: notes.oracle, conversation: own },
    }
    await Promise.all(strategies.map(async strategy => {
      const answer = await client.complete({ system: ANSWER_SYSTEM, user: JSON.stringify({ ...contextFor[strategy], question: probe.question }), maxTokens: 200, details: true, tag: `answer:${probe.id}:${strategy}` })
      const text = String(answer.value).trim()
      spent.answer += answer.usage?.input ?? 0
      rows.push({ kind: 'answer', session_id: id, lang: session.lang, probe: probe.id, category: probe.category, strategy, at: probe.after, gold: probe.gold,
        answer: text.slice(0, 300), verdict: judgeAnswer(text, probe, timeline), context_tokens: answer.usage?.input ?? 0, notes_chars: contextFor[strategy].notes?.length ?? 0 })
    }))
  }

  for (const turn of session.turns) {
    const thread = turn.gold.thread
    // Routing with and without facts on a sample of the session's own turns that have candidates.
    if (withFacts && thread && turn.i > 0 && checked < routeTurns && factCandidates(store, SCOPE, turn.text, chat.slice(-12).map(message => message.text), current).length && random() < 0.4) {
      checked++
      await routeBoth(turn.text, chat, thread, turn.i, `${id}:t${turn.i}`)
    }
    chat.push({ role: 'user', text: turn.text }, { role: 'assistant', text: turn.assistant ?? '' })
    if (thread) {
      const list = events.get(thread)
      list.push({ seq: ++seq, speaker: 'user', text: turn.text }, { seq: ++seq, speaker: 'assistant', text: turn.assistant ?? '' })
      current = thread
      if (withFacts) {
        // What the plugin does when a turn ends with extraction on, with the same checks and limits.
        const base = store.facts(thread)
        const payload = extractionPayload(list, base)
        if (payload) {
          try {
            const answer = await client.complete({ system: EXTRACT_PROMPT, user: JSON.stringify(payload), maxTokens: 1024, json: true, details: true, tag: `extract:${id}:${turn.i}` })
            spent.extract += answer.usage?.input ?? 0
            applyExtraction(store, { sessionId: `${id}/${thread}`, contextId: thread, events: list, base, items: answer.value })
          } catch (error) { rows.push({ kind: 'error', session_id: id, at: turn.i, step: 'extract', error: String(error.message).slice(0, 200) }) }
        }
      }
    }
    for (const probe of probes.get(turn.i) ?? []) await answerProbe(probe)
  }
  const facts = session.threads.flatMap(thread => store.facts(thread.id).map(fact => ({ thread: thread.id, label: fact.label, status: fact.status, value: fact.value, version: fact.version })))
  rows.push({ kind: 'session', session_id: id, lang: session.lang, probes: session.probes?.length ?? 0, tokens: spent, facts })
  return rows
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: {
    data: { type: 'string', default: join(here, 'data', 'interleave-v1', 'sessions.jsonl') },
    split: { type: 'string', default: 'dev' }, strategies: { type: 'string', default: STRATEGIES.join(',') },
    'route-turns': { type: 'string', default: '6' }, model: { type: 'string' }, out: { type: 'string' },
    'dry-run': { type: 'boolean', default: false }, limit: { type: 'string' } } })
  const strategies = values.strategies.split(',')
  if (strategies.some(strategy => !STRATEGIES.includes(strategy))) throw new Error(`--strategies: some of ${STRATEGIES.join(',')}`)
  const dry = values['dry-run']
  const client = await createClient({ model: values.model, cacheDir: join(here, '.cache', dry ? 'fake' : 'llm'), fake: dry ? join(here, 'test', 'fake-model.mjs') : undefined })
  const data = dry && !values.data.includes('-dry') ? values.data.replace('interleave-v1', 'interleave-v1-dry') : values.data
  let sessions = readSessions(data).filter(session => values.split === 'all' || session.split === values.split)
  if (!sessions.every(session => Array.isArray(session.probes))) throw new Error(`${data} has no probes; generate a v1 dataset first (node eval/generate.mjs)`)
  if (values.limit) sessions = sessions.slice(0, Number(values.limit))
  const out = values.out ?? join(dirname(data), 'facts', `${client.model.replace(/[^\w.-]+/g, '_')}.jsonl`)
  const timer = setInterval(() => console.error(`… ${client.usage}`), 15000)
  try {
    const failed = []
    const rows = (await Promise.all(sessions.map(session => runSession(session, { client, strategies, routeTurns: Number(values['route-turns']) }).catch(error => {
      failed.push(session.session_id); console.error(`${session.session_id} skipped: ${error.message}`); return []
    })))).flat()
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, rows.map(row => JSON.stringify(row)).join('\n') + '\n')
    console.log(`${rows.filter(row => row.kind === 'answer').length} answers from ${sessions.length - failed.length} sessions → ${out}`)
    console.log(`Score: python3 eval/score_facts.py ${out}`)
    console.log(`Model: ${client.model} · ${client.usage}${dry ? ' (fake model: nothing was spent)' : ''}`)
  } finally { clearInterval(timer) }
}

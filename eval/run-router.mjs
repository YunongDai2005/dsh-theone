#!/usr/bin/env node
// Replay InterleaveBench sessions through TheOne's own routing code (its prompt, payload and decision
// validation from dist/), one message at a time, and write what it decided for each message.
//
//   node eval/run-router.mjs --mode closed            the topic list is known up front (a built catalog)
//   node eval/run-router.mjs --mode open              topics are created as the chat goes, as on first use
//   --policy llm      every message goes to the model
//   --policy theone   plus TheOne's fast path ("ok", "go on" stay put) and its rules when the model fails
//   --merge all|adaptive   wait for messages sent in a burst and route them as one request (simulated
//                          arrivals: --same / --cross are the chances a message follows the previous one
//                          within the window, for the same thread and for another; see lib/bursts.mjs)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { ROUTING_PROMPT, routingPayload, validateRoutingDecision } from '../dist/llm-router.js'
import { continuesCurrent, topicTerms } from '../dist/routing-policy.js'
import { resolveContext } from '../dist/router.js'
import { createClient } from './lib/llm.mjs'
import { groupUnits, planArrivals } from './lib/bursts.mjs'

const here = dirname(fileURLToPath(import.meta.url))

export const readSessions = file => readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))

/** Route every message of one session in order; returns one prediction per message. */
export async function routeSession(session, { mode, policy, client, merge = 'none', bursts = {} }) {
  // Topics the router can choose from. Closed: the session's threads, described as a catalog would.
  // Open: only what the router itself created, described by the messages it put there.
  const topics = mode === 'closed'
    ? session.threads.map(thread => ({ id: thread.id, title: thread.title, summary: thread.description, entities: [], keywords: [], lastState: '', texts: [] }))
    : []
  const describe = topic => ({ id: topic.id, title: topic.title, summary: topic.summary, entities: topic.entities,
    keywords: [...new Set(topic.texts.flatMap(text => topicTerms(text)))].slice(-24), lastState: topic.texts.at(-1)?.slice(0, 400) ?? topic.lastState })
  const recent = []
  const out = []
  let current, created = 0
  const arrivals = planArrivals(session.turns, bursts)
  for (const unit of groupUnits(session.turns, arrivals, merge)) {
    const members = unit.turns.map(i => session.turns[i])
    // A burst is one request: its messages, in order, as the user sent them.
    const text = members.map(turn => turn.text).join('\n')
    const contexts = topics.map(describe)
    const input = { text, contexts, currentId: current, recent: recent.slice(-12) }
    let decision, usage, error, via = 'llm'
    const started = performance.now()
    if (policy === 'theone' && current && continuesCurrent(text)) { decision = { action: 'KEEP', contextId: current, reason: 'fast path' }; via = 'fast' }
    else {
      try {
        const payload = routingPayload(input)
        // Calls run concurrently, so each call's tokens come from its own response, not the running total.
        // A single message keeps the tag it always had, so earlier answers are reused from the cache.
        const tag = `route:${session.session_id}:${members.length > 1 ? unit.turns.join('+') : members[0].i}:${mode}:${policy}`
        const answer = await client.complete({ system: ROUTING_PROMPT, user: JSON.stringify(payload), maxTokens: 2048, json: true, details: true, tag })
        if (answer.usage) usage = { input: answer.usage.input ?? 0, output: answer.usage.output ?? 0, cache_hit: answer.usage.cached ?? 0 }
        if (answer.cached) via = 'cache'
        decision = validateRoutingDecision(answer.value, input)
      } catch (failure) {
        error = String(failure.code ?? failure.message).slice(0, 120)
        if (policy === 'theone') { decision = resolveContext(text, contexts, current); via = 'rules' }
      }
    }
    let pred = 'ERROR'
    if (decision?.action === 'CREATE') {
      const topic = { id: `${mode === 'closed' ? 'n' : 'p'}${++created}`, title: decision.title, summary: text.slice(0, 200), entities: [], keywords: [], lastState: '', texts: [] }
      topics.push(topic); pred = topic.id
    } else if (decision?.action === 'CLARIFY') pred = 'CLARIFY'
    else if (decision?.contextId) pred = decision.contextId
    const topic = topics.find(item => item.id === pred)
    if (topic) { topic.texts.push(...members.map(turn => turn.text)); current = topic.id }
    recent.push(...members.map(turn => ({ role: 'user', text: turn.text })))
    const elapsed = Math.round(performance.now() - started)
    // Every message gets the request's decision; the call's tokens are counted once, on the first.
    // `mixed` (gold labels, for reporting only) marks a burst that spanned more than one thread.
    const mixed = new Set(members.map(turn => turn.gold.thread ?? 'none')).size > 1
    members.forEach((turn, k) => out.push({ session_id: session.session_id, i: turn.i, mode, policy, pred, action: decision?.action ?? null, refs: decision?.relatedIds ?? [],
      via, ...(usage && k === 0 ? { usage } : {}), elapsed_ms: elapsed, ...(error ? { error } : {}),
      ...(merge !== 'none' ? { merge, burst: members.length, waited: unit.waited, ...(mixed ? { mixed } : {}) } : {}) }))
  }
  return out
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: {
    data: { type: 'string', default: join(here, 'data', 'interleave-v0', 'sessions.jsonl') },
    mode: { type: 'string', default: 'closed' }, policy: { type: 'string', default: 'llm' }, split: { type: 'string', default: 'dev' },
    model: { type: 'string' }, out: { type: 'string' }, 'dry-run': { type: 'boolean', default: false }, limit: { type: 'string' },
    merge: { type: 'string', default: 'none' }, same: { type: 'string', default: '0.35' }, cross: { type: 'string', default: '0.05' }, 'burst-seed': { type: 'string', default: '1' } } })
  if (!['closed', 'open'].includes(values.mode) || !['llm', 'theone'].includes(values.policy)) throw new Error('--mode closed|open, --policy llm|theone')
  if (!['none', 'all', 'adaptive'].includes(values.merge)) throw new Error('--merge none|all|adaptive')
  const bursts = { same: Number(values.same), cross: Number(values.cross), seed: Number(values['burst-seed']) }
  const dry = values['dry-run']
  const client = await createClient({ model: values.model, cacheDir: join(here, '.cache', dry ? 'fake' : 'llm'), fake: dry ? join(here, 'test', 'fake-model.mjs') : undefined })
  let sessions = readSessions(values.data).filter(session => values.split === 'all' || session.split === values.split)
  if (values.limit) sessions = sessions.slice(0, Number(values.limit))
  const name = `${values.mode}-${values.policy}${values.merge === 'none' ? '' : `-${values.merge}-s${values.same}-c${values.cross}`}-${client.model.replace(/[^\w.-]+/g, '_')}`
  const out = values.out ?? join(dirname(values.data), 'predictions', `${name}.jsonl`)
  const timer = setInterval(() => console.error(`… ${client.usage}`), 15000)
  try {
    const rows = (await Promise.all(sessions.map(session => routeSession(session, { mode: values.mode, policy: values.policy, client, merge: values.merge, bursts })))).flat()
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, rows.map(row => JSON.stringify(row)).join('\n') + '\n')
    console.log(`Routed ${rows.length} messages from ${sessions.length} sessions → ${out}`)
    console.log(`${rows.filter(row => row.error).length} model failures · ${client.usage}`)
  } finally { clearInterval(timer) }
}

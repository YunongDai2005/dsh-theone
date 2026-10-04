#!/usr/bin/env node
// Replay InterleaveBench sessions through TheOne's own routing code (its prompt, payload and decision
// validation from dist/), one message at a time, and write what it decided for each message.
//
//   node eval/run-router.mjs --mode closed            the topic list is known up front (a built catalog)
//   node eval/run-router.mjs --mode open              topics are created as the chat goes, as on first use
//   --policy llm      every message goes to the model
//   --policy theone   plus TheOne's fast path ("ok", "go on" stay put) and its rules when the model fails
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { ROUTING_PROMPT, routingPayload, validateRoutingDecision } from '../dist/llm-router.js'
import { continuesCurrent, topicTerms } from '../dist/routing-policy.js'
import { resolveContext } from '../dist/router.js'
import { createClient } from './lib/llm.mjs'

const here = dirname(fileURLToPath(import.meta.url))

export const readSessions = file => readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))

/** Route every message of one session in order; returns one prediction per message. */
export async function routeSession(session, { mode, policy, client }) {
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
  for (const turn of session.turns) {
    const contexts = topics.map(describe)
    const input = { text: turn.text, contexts, currentId: current, recent: recent.slice(-12) }
    let decision, usage, error, via = 'llm'
    const started = performance.now()
    if (policy === 'theone' && current && continuesCurrent(turn.text)) { decision = { action: 'KEEP', contextId: current, reason: 'fast path' }; via = 'fast' }
    else {
      try {
        const payload = routingPayload(input)
        const before = { ...client.usage }
        const answer = await client.complete({ system: ROUTING_PROMPT, user: JSON.stringify(payload), maxTokens: 2048, json: true, tag: `route:${session.session_id}:${turn.i}:${mode}:${policy}` })
        usage = { input: client.usage.input - before.input, output: client.usage.output - before.output, cache_hit: client.usage.cacheHit - before.cacheHit }
        decision = validateRoutingDecision(answer, input)
      } catch (failure) {
        error = String(failure.code ?? failure.message).slice(0, 120)
        if (policy === 'theone') { decision = resolveContext(turn.text, contexts, current); via = 'rules' }
      }
    }
    let pred = 'ERROR'
    if (decision?.action === 'CREATE') {
      const topic = { id: `${mode === 'closed' ? 'n' : 'p'}${++created}`, title: decision.title, summary: turn.text.slice(0, 200), entities: [], keywords: [], lastState: '', texts: [] }
      topics.push(topic); pred = topic.id
    } else if (decision?.action === 'CLARIFY') pred = 'CLARIFY'
    else if (decision?.contextId) pred = decision.contextId
    const topic = topics.find(item => item.id === pred)
    if (topic) { topic.texts.push(turn.text); current = topic.id }
    recent.push({ role: 'user', text: turn.text })
    out.push({ session_id: session.session_id, i: turn.i, mode, policy, pred, action: decision?.action ?? null, refs: decision?.relatedIds ?? [],
      via, ...(usage ? { usage } : {}), elapsed_ms: Math.round(performance.now() - started), ...(error ? { error } : {}) })
  }
  return out
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: {
    data: { type: 'string', default: join(here, 'data', 'interleave-v0', 'sessions.jsonl') },
    mode: { type: 'string', default: 'closed' }, policy: { type: 'string', default: 'llm' }, split: { type: 'string', default: 'dev' },
    model: { type: 'string' }, out: { type: 'string' }, 'dry-run': { type: 'boolean', default: false }, limit: { type: 'string' } } })
  if (!['closed', 'open'].includes(values.mode) || !['llm', 'theone'].includes(values.policy)) throw new Error('--mode closed|open, --policy llm|theone')
  const dry = values['dry-run']
  const client = await createClient({ model: values.model, cacheDir: join(here, '.cache', dry ? 'fake' : 'llm'), fake: dry ? join(here, 'test', 'fake-model.mjs') : undefined })
  let sessions = readSessions(values.data).filter(session => values.split === 'all' || session.split === values.split)
  if (values.limit) sessions = sessions.slice(0, Number(values.limit))
  const name = `${values.mode}-${values.policy}-${client.model.replace(/[^\w.-]+/g, '_')}`
  const out = values.out ?? join(dirname(values.data), 'predictions', `${name}.jsonl`)
  const timer = setInterval(() => console.error(`… ${client.usage}`), 15000)
  try {
    const rows = (await Promise.all(sessions.map(session => routeSession(session, { mode: values.mode, policy: values.policy, client })))).flat()
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, rows.map(row => JSON.stringify(row)).join('\n') + '\n')
    console.log(`Routed ${rows.length} messages from ${sessions.length} sessions → ${out}`)
    console.log(`${rows.filter(row => row.error).length} model failures · ${client.usage}`)
  } finally { clearInterval(timer) }
}

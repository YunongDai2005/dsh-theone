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
//   --decide joint|each    a burst gets one decision for all its messages (joint), or is sent in one call
//                          that decides each message separately (each); a malformed answer falls back
//                          to routing its messages one by one
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { ROUTING_PROMPT, routingPayload, validateRoutingDecision, redactRoutingText } from '../dist/llm-router.js'
import { continuesCurrent, topicTerms } from '../dist/routing-policy.js'
import { resolveContext } from '../dist/router.js'
import { createClient } from './lib/llm.mjs'
import { groupUnits, planArrivals } from './lib/bursts.mjs'

const here = dirname(fileURLToPath(import.meta.url))

/** Added to the routing prompt when a burst's messages are decided one by one in a single call. */
export const BATCH_PROMPT = `
本轮不是一条 text，而是用户在收到回复前连续发出的几条消息 texts（按发送顺序）。它们可能说的是同一件事，也可能分属不同的事。逐条判断每条应使用哪个话题，规则同上；后面的消息可以借前面的消息理解指代和省略，但不要因为挨着发就默认属于同一件事。
前面某条 CREATE 的新话题，后面属于同一件事的消息选 EXISTING，contextId 写 "new:序号"（序号是那条消息在 texts 中的位置，从 0 开始）。
输出 JSON：{"decisions":[与 texts 等长、按顺序，每项格式同上]}。`

/**
 * One decision per message from a batch answer, checked with TheOne's own validation: message k sees
 * the catalog plus the topics created before it in the batch (as "new:j"), and the topic it would
 * be on after the messages before it. Throws when the answer does not fit.
 */
export function batchDecisions(value, texts, contexts, currentId) {
  const list = value?.decisions
  if (!Array.isArray(list) || list.length !== texts.length) throw Object.assign(new Error('batch shape'), { code: 'BATCH_INVALID' })
  const created = []
  let current = currentId
  return list.map((row, k) => {
    const input = { text: texts[k], contexts: [...contexts, ...created], currentId: current }
    const decision = validateRoutingDecision(row, input)
    if (decision.action === 'CREATE') { created.push({ id: `new:${k}`, title: decision.title, summary: '', entities: [], keywords: [], lastState: '' }); current = `new:${k}` }
    else if (decision.contextId) current = decision.contextId
    return decision
  })
}

export const readSessions = file => readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))

/** Route every message of one session in order; returns one prediction per message. */
export async function routeSession(session, { mode, policy, client, merge = 'none', decide = 'joint', bursts = {} }) {
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
  const usageOf = answer => answer.usage ? { input: answer.usage.input ?? 0, output: answer.usage.output ?? 0, cache_hit: answer.usage.cached ?? 0 } : undefined
  /** Apply one decision for `members`: create the topic it names, move to it, remember the messages. */
  const apply = (decision, members, text, batchIds) => {
    let pred = 'ERROR'
    if (decision?.action === 'CREATE') {
      const topic = { id: `${mode === 'closed' ? 'n' : 'p'}${++created}`, title: decision.title, summary: text.slice(0, 200), entities: [], keywords: [], lastState: '', texts: [] }
      topics.push(topic); pred = topic.id
    } else if (decision?.action === 'CLARIFY') pred = 'CLARIFY'
    else if (decision?.contextId) pred = batchIds?.get(decision.contextId) ?? decision.contextId
    const topic = topics.find(item => item.id === pred)
    if (topic) { topic.texts.push(...members.map(turn => turn.text)); current = topic.id }
    recent.push(...members.map(turn => ({ role: 'user', text: turn.text })))
    return pred
  }
  /** Route `members` as one request with one decision, as TheOne does today. */
  const routeJoint = async (members, tag) => {
    // A burst is one request: its messages, in order, as the user sent them.
    const text = members.map(turn => turn.text).join('\n')
    const contexts = topics.map(describe)
    const input = { text, contexts, currentId: current, recent: recent.slice(-12) }
    let decision, usage, error, via = 'llm'
    if (policy === 'theone' && current && continuesCurrent(text)) { decision = { action: 'KEEP', contextId: current, reason: 'fast path' }; via = 'fast' }
    else {
      try {
        const payload = routingPayload(input)
        // Calls run concurrently, so each call's tokens come from its own response, not the running total.
        const answer = await client.complete({ system: ROUTING_PROMPT, user: JSON.stringify(payload), maxTokens: 2048, json: true, details: true, tag })
        usage = usageOf(answer)
        if (answer.cached) via = 'cache'
        decision = validateRoutingDecision(answer.value, input)
      } catch (failure) {
        error = String(failure.code ?? failure.message).slice(0, 120)
        if (policy === 'theone') { decision = resolveContext(text, contexts, current); via = 'rules' }
      }
    }
    const pred = apply(decision, members, text)
    return members.map(() => ({ pred, decision, via, usage, error }))
  }
  /** Route a burst in one call that decides each message; malformed answers fall back to one by one. */
  const routeEach = async (members, tag) => {
    const texts = members.map(turn => turn.text)
    if (policy === 'theone' && current && texts.every(text => continuesCurrent(text))) return routeJoint(members, tag)
    const contexts = topics.map(describe)
    let answer
    try {
      const payload = routingPayload({ text: texts.join('\n'), contexts, currentId: current, recent: recent.slice(-12) })
      delete payload.text
      payload.texts = texts.map(text => redactRoutingText(text).slice(0, 2000))
      answer = await client.complete({ system: ROUTING_PROMPT + BATCH_PROMPT, user: JSON.stringify(payload), maxTokens: 4096, json: true, details: true, tag: `${tag}:each` })
      const decisions = batchDecisions(answer.value, texts, contexts, current)
      const batchIds = new Map()
      const via = answer.cached ? 'cache' : 'llm'
      return decisions.map((decision, k) => {
        const pred = apply(decision, [members[k]], texts[k], batchIds)
        if (decision.action === 'CREATE') batchIds.set(`new:${k}`, pred)
        return { pred, decision, via, usage: k === 0 ? usageOf(answer) : undefined }
      })
    } catch (failure) {
      const rows = []
      for (const turn of members) rows.push(...(await routeJoint([turn], `route:${session.session_id}:${turn.i}:${mode}:${policy}`)))
      // The failed batch call's tokens still count, on the first message.
      const spent = answer && usageOf(answer)
      const first = rows[0].usage
      const usage = spent && first ? Object.fromEntries(Object.keys(spent).map(key => [key, spent[key] + (first[key] ?? 0)])) : spent ?? first
      rows[0] = { ...rows[0], usage, error: String(failure.code ?? failure.message).slice(0, 120) }
      return rows.map(row => ({ ...row, via: `fallback-${row.via}` }))
    }
  }
  for (const unit of groupUnits(session.turns, arrivals, merge)) {
    const members = unit.turns.map(i => session.turns[i])
    const started = performance.now()
    // A single message keeps the tag it always had, so earlier answers are reused from the cache.
    const tag = `route:${session.session_id}:${members.length > 1 ? unit.turns.join('+') : members[0].i}:${mode}:${policy}`
    const results = members.length > 1 && decide === 'each' ? await routeEach(members, tag) : await routeJoint(members, tag)
    const elapsed = Math.round(performance.now() - started)
    // The call's tokens are counted once, on the first message.
    // `mixed` (gold labels, for reporting only) marks a burst that spanned more than one thread.
    const mixed = new Set(members.map(turn => turn.gold.thread ?? 'none')).size > 1
    members.forEach((turn, k) => {
      const { pred, decision, via, usage, error } = results[k]
      out.push({ session_id: session.session_id, i: turn.i, mode, policy, pred, action: decision?.action ?? null, refs: decision?.relatedIds ?? [],
        via, ...(usage && (k === 0 || decide === 'each') ? { usage } : {}), elapsed_ms: elapsed, ...(error ? { error } : {}),
        ...(merge !== 'none' ? { merge, decide, burst: members.length, waited: unit.waited, ...(mixed ? { mixed } : {}) } : {}) })
    })
  }
  return out
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: {
    data: { type: 'string', default: join(here, 'data', 'interleave-v0', 'sessions.jsonl') },
    mode: { type: 'string', default: 'closed' }, policy: { type: 'string', default: 'llm' }, split: { type: 'string', default: 'dev' },
    model: { type: 'string' }, out: { type: 'string' }, 'dry-run': { type: 'boolean', default: false }, limit: { type: 'string' },
    merge: { type: 'string', default: 'none' }, decide: { type: 'string', default: 'joint' }, same: { type: 'string', default: '0.35' }, cross: { type: 'string', default: '0.05' }, 'burst-seed': { type: 'string', default: '1' } } })
  if (!['closed', 'open'].includes(values.mode) || !['llm', 'theone'].includes(values.policy)) throw new Error('--mode closed|open, --policy llm|theone')
  if (!['none', 'all', 'adaptive'].includes(values.merge)) throw new Error('--merge none|all|adaptive')
  if (!['joint', 'each'].includes(values.decide)) throw new Error('--decide joint|each')
  const bursts = { same: Number(values.same), cross: Number(values.cross), seed: Number(values['burst-seed']) }
  const dry = values['dry-run']
  const client = await createClient({ model: values.model, cacheDir: join(here, '.cache', dry ? 'fake' : 'llm'), fake: dry ? join(here, 'test', 'fake-model.mjs') : undefined })
  let sessions = readSessions(values.data).filter(session => values.split === 'all' || session.split === values.split)
  if (values.limit) sessions = sessions.slice(0, Number(values.limit))
  const name = `${values.mode}-${values.policy}${values.merge === 'none' ? '' : `-${values.merge}${values.decide === 'each' ? '-each' : ''}-s${values.same}-c${values.cross}`}-${client.model.replace(/[^\w.-]+/g, '_')}`
  const out = values.out ?? join(dirname(values.data), 'predictions', `${name}.jsonl`)
  const timer = setInterval(() => console.error(`… ${client.usage}`), 15000)
  try {
    const rows = (await Promise.all(sessions.map(session => routeSession(session, { mode: values.mode, policy: values.policy, client, merge: values.merge, decide: values.decide, bursts })))).flat()
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, rows.map(row => JSON.stringify(row)).join('\n') + '\n')
    console.log(`Routed ${rows.length} messages from ${sessions.length} sessions → ${out}`)
    console.log(`${rows.filter(row => row.error).length} model failures · ${client.usage}`)
  } finally { clearInterval(timer) }
}

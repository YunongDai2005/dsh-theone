#!/usr/bin/env node
// Write InterleaveBench sessions: one person, one chat, several work threads at once.
// Every label comes from the plan the messages are written from, then a second model pass marks
// messages a careful reader could not attribute.
//   v0  the user's messages only; for routing
//   v1  the assistant's replies too, the life of each fact (stated, changed, proposed and accepted or
//       turned down, withdrawn) and probe questions about other topics' facts; for shared facts
//
//   node eval/generate.mjs --sessions 50                       (v1; needs DEEPSEEK_API_KEY)
//   node eval/generate.mjs --sessions 50 --dataset v0          (the routing set, as first published)
//   node eval/generate.mjs --sessions 4 --dry-run              (fake model, costs nothing)
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { buildSchedule, planFactEpisodes, rng } from './lib/schedule.mjs'
import { buildProbes } from './lib/probes.mjs'
import { createClient } from './lib/llm.mjs'
import { DOMAINS, JUDGE_SYSTEM, RENDER_SYSTEM, RENDER_SYSTEM_V1, SPEC_SYSTEM, SPEC_SYSTEM_V1, leaksTitle } from './lib/prompts.mjs'

const here = dirname(fileURLToPath(import.meta.url))
export const VERSIONS = { v0: 'interleave-v0', v1: 'interleave-v1' }
export const VERSION = VERSIONS.v1

/** Independent checks that the rendered acceptance/withdrawal actually carries its planned event. */
export function matchesFactStep(fact, user, assistant, states) {
  if (!fact) return true
  const { kind, value } = fact
  const question = /[?？]|(吗|呢)\s*[。！!]?\s*$/.test(user.trim())
  const refusal = /(不行|不要|不用|不同意|拒绝|换成|\b(no|not|reject|instead|prefer)\b|don'?t)/i.test(user)
  if (kind === 'propose') return states(assistant, value) && !states(user, value)
  // Broader than the plugin's acceptance vocabulary: phrases the implementation misses are tested.
  if (kind === 'accept') return !states(user, value) && !question && !refusal &&
    /(好的?|就按|就这样|就用|同意|没问题|照这个|照你|这么办|定了|\b(ok(ay)?|yes|sure|agreed?|deal)\b|sounds (good|reasonable)|go with|make it so|that'?ll do|works for me)/i.test(user)
  if (kind === 'retract') return !question &&
    /(撤回|取消|不再|未定|没定|没(?:有)?确定|先不定|待定|再决定|\b(undecided|withdrawn?|cancel(led|ed)?)\b|no longer|is off|not (yet )?(settled|decided)|decide later)/i.test(user)
  return states(user, value) && !question && (kind !== 'reject' || refusal)
}

export async function generate(options) {
  const { sessions: count = 50, seed = 1, langs = ['zh', 'en'], minThreads = 3, maxThreads = 5, minTurns = 40, maxTurns = 60,
    chunk = 8, judge = true, dataset = 'v1', out, client, log = () => {} } = options
  if (!VERSIONS[dataset]) throw new Error(`Unknown dataset ${dataset}; use v0 or v1`)
  const v1 = dataset === 'v1'
  // v1 checks that each exchange did what its fact step asked, with the plugin's own matching.
  const facts = v1 ? await import('../dist/facts.js') : undefined
  const make = async index => {
    const random = rng(seed * 100003 + index)
    const lang = langs[index % langs.length]
    const threadCount = minThreads + Math.floor(random() * (maxThreads - minThreads + 1))
    const length = minTurns + Math.floor(random() * (maxTurns - minTurns + 1))
    const twin = threadCount >= 3 && random() < 0.5
    const pool = [...DOMAINS].sort(() => random() - 0.5)
    const domains = pool.slice(0, threadCount)
    if (twin) domains[2] = domains[1]
    const id = `${lang}-${String(index + 1).padStart(4, '0')}`

    // 1. The threads and their facts; an answer of the wrong shape is asked for again.
    let spec
    for (let attempt = 0; ; attempt++) {
      spec = await client.complete({ system: v1 ? SPEC_SYSTEM_V1 : SPEC_SYSTEM, user: JSON.stringify({ lang, threadCount, domains, twin }), json: true, temperature: 0.9, tag: `spec:${id}${attempt ? `:${attempt}` : ''}` })
      if (Array.isArray(spec.threads) && spec.threads.length === threadCount && spec.threads.every(thread => thread?.title)) break
      if (attempt >= 2) throw new Error(`${id}: expected ${threadCount} threads`)
    }
    const threads = spec.threads.map((thread, position) => ({ id: `t${position + 1}`, title: String(thread.title), domain: String(thread.domain ?? domains[position]),
      goal: String(thread.goal ?? ''), description: String(thread.description ?? ''),
      facts: (thread.facts ?? []).slice(0, 3).map(fact => ({ key: String(fact.key), value: String(fact.value), update: fact.update == null ? null : String(fact.update),
        ...(v1 ? { alternative: fact.alternative == null || String(fact.alternative) === String(fact.value) ? null : String(fact.alternative) } : {}) })),
      constraints: (thread.constraints ?? []).slice(0, 1).map(String), ...(twin && position === 2 ? { twinOf: 't2' } : {}) }))

    // 2. The plan: the ground truth for every message.
    // v1 lays the facts' episodes over the same plan; which thread speaks when does not change.
    const routed = buildSchedule(threads.map(thread => ({ id: thread.id, twinOf: thread.twinOf, facts: thread.facts.map(fact => ({ key: fact.key, update: fact.update != null })) })), length, seed * 7919 + index)
    const episodes = v1 ? planFactEpisodes(routed, threads, seed * 7919 + index) : undefined
    const plan = episodes?.turns ?? routed
    if (v1) return finish(await renderV1(plan, episodes), episodes)

    // 3. Messages, a chunk at a time, each chunk seeing what was written before it.
    return finish({ texts: await renderV0(plan) })

    async function renderV0(plan) {
      const cards = threads.map(({ id, title, goal, description, facts }) => ({ id, title, goal, description, facts }))
      const texts = []
      const recent = () => texts.slice(-6).map((text, offset) => { const turn = plan[texts.length - Math.min(6, texts.length) + offset]; return { thread: turn.thread ?? 'ONE-OFF', text } })
      const entry = turn => ({ n: turn.i, thread: turn.thread ?? 'ONE-OFF', action: turn.action, style: turn.style, refs: turn.refs,
        ...(turn.fact ? { fact: { ...turn.fact, ...threads.find(thread => thread.id === turn.thread).facts.find(fact => fact.key === turn.fact.key) } } : {}) })
      for (let start = 0; start < plan.length; start += chunk) {
        const part = plan.slice(start, start + chunk)
        const answer = await client.complete({ system: RENDER_SYSTEM, user: JSON.stringify({ lang, persona: spec.persona, threads: cards, previous: recent(), plan: part.map(entry) }),
          json: true, temperature: 0.9, maxTokens: 3000, tag: `render:${id}:${start}` })
        const written = new Map((answer.messages ?? []).map(message => [message.n, String(message.text ?? '').trim()]))
        for (const turn of part) {
          let text = written.get(turn.i)
          const title = turn.thread && threads.find(thread => thread.id === turn.thread).title
          // A message meant to be vague that names its subject is rewritten once on its own.
          if (!text || (title && ['implicit', 'pronoun'].includes(turn.style) && leaksTitle(text, title, lang))) {
            const retry = await client.complete({ system: RENDER_SYSTEM, user: JSON.stringify({ lang, persona: spec.persona, threads: cards, previous: recent(), plan: [entry(turn)],
              note: 'Do not use any word from the thread title or its subject in this message.' }), json: true, temperature: 1, maxTokens: 600, tag: `rewrite:${id}:${turn.i}` })
            text = String(retry.messages?.[0]?.text ?? text ?? '').trim()
            if (!text) throw new Error(`${id}: no message for turn ${turn.i}`)
            if (title && ['implicit', 'pronoun'].includes(turn.style) && leaksTitle(text, title, lang)) turn.tags.push('leak')
          }
          texts.push(text)
        }
      }
      return texts
    }

    // v1: an exchange per plan entry, the assistant's reply included, written to its fact step.
    async function renderV1(plan, episodes) {
      const cards = threads.map(({ id, title, goal, description }) => ({ id, title, goal, description }))
      const texts = [], replies = []
      const recent = () => texts.slice(-6).map((text, offset) => { const turn = plan[texts.length - Math.min(6, texts.length) + offset]; return { thread: turn.thread ?? 'ONE-OFF', user: text, assistant: replies[texts.length - Math.min(6, texts.length) + offset] } })
      const rejected = turn => episodes.timeline.findLast(event => event.thread === turn.thread && event.key === turn.fact.key && event.kind === 'propose' && event.turn < turn.i)?.value
      const entry = turn => ({ n: turn.i, thread: turn.thread ?? 'ONE-OFF', action: turn.action, style: turn.style, refs: turn.refs,
        ...(turn.fact ? { fact: { key: turn.fact.key, kind: turn.fact.kind, ...(turn.fact.value == null ? {} : { value: turn.fact.value }), ...(turn.fact.kind === 'reject' ? { rejected: rejected(turn) } : {}) } } : {}) })
      // Did the exchange do what its fact step asked? Checked with the plugin's own matching.
      const done = (turn, user, assistant) => matchesFactStep(turn.fact, user, assistant, facts.states)
      for (let start = 0; start < plan.length; start += chunk) {
        const part = plan.slice(start, start + chunk)
        const answer = await client.complete({ system: RENDER_SYSTEM_V1, user: JSON.stringify({ lang, persona: spec.persona, threads: cards, previous: recent(), plan: part.map(entry) }),
          json: true, temperature: 0.9, maxTokens: 6000, tag: `render1:${id}:${start}` })
        const written = new Map((answer.messages ?? []).map(message => [message.n, { user: String(message.user ?? '').trim(), assistant: String(message.assistant ?? '').trim() }]))
        for (const turn of part) {
          let { user = '', assistant = '' } = written.get(turn.i) ?? {}
          const title = turn.thread && threads.find(thread => thread.id === turn.thread).title
          const leaks = text => title && ['implicit', 'pronoun'].includes(turn.style) && leaksTitle(text, title, lang)
          // An exchange that names a subject it should not, or misses its fact step, is rewritten once.
          if (!user || !assistant || leaks(user) || !done(turn, user, assistant)) {
            const retry = await client.complete({ system: RENDER_SYSTEM_V1, user: JSON.stringify({ lang, persona: spec.persona, threads: cards, previous: recent(), plan: [entry(turn)],
              note: 'Follow the fact step exactly, and do not use any word from the thread title in the user message unless the style is explicit or cue.' }), json: true, temperature: 1, maxTokens: 1000, tag: `rewrite1:${id}:${turn.i}` })
            const again = retry.messages?.[0] ?? {}
            user = String(again.user ?? '').trim() || user
            assistant = String(again.assistant ?? '').trim() || assistant
            if (!user || !assistant) throw new Error(`${id}: no exchange for turn ${turn.i}`)
            if (leaks(user)) turn.tags.push('leak')
            // The plan stays the ground truth; a step the text does not carry makes its fact unusable.
            if (!done(turn, user, assistant)) turn.tags.push('fact-miss')
          }
          texts.push(user); replies.push(assistant)
        }
      }
      return { texts, replies }
    }

    async function finish({ texts, replies }, episodes) {
      // 4. An independent reading of each message, without the plan.
      const labels = new Map()
      if (judge) {
        const brief = threads.map(({ id, title, description }) => ({ id, title, description }))
        await Promise.all(Array.from({ length: Math.ceil(plan.length / chunk) }, async (_, part) => {
          const start = part * chunk
          const before = plan.slice(Math.max(0, start - 6), start).map(turn => ({ n: turn.i, thread: turn.thread ?? 'none', text: texts[turn.i] }))
          const answer = await client.complete({ system: JUDGE_SYSTEM, user: JSON.stringify({ threads: brief, earlier: before,
            messages: plan.slice(start, start + chunk).map(turn => ({ n: turn.i, text: texts[turn.i] })) }), json: true, temperature: 0, maxTokens: 1500, tag: `judge:${id}:${start}` })
          for (const label of answer.labels ?? []) labels.set(label.n, label)
        }))
      }

      const turns = plan.map(turn => {
        const label = labels.get(turn.i)
        const gold = turn.thread ?? 'none'
        const ambiguous = !!label && label.thread !== gold
        return { i: turn.i, text: texts[turn.i], ...(replies ? { assistant: replies[turn.i] } : {}), gold: { thread: turn.thread, action: turn.action, refs: turn.refs }, style: turn.style,
          ...(turn.fact ? { fact: turn.fact } : {}), tags: turn.tags, ...(label ? { judge: label.thread === 'ambiguous' ? { thread: 'ambiguous', candidates: label.candidates ?? [] } : { thread: label.thread } } : {}),
          ambiguous }
      })
      log(`${id}: ${threads.length} threads, ${turns.length} messages, ${turns.filter(turn => turn.ambiguous).length} ambiguous`)
      const session = { session_id: id, version: VERSIONS[dataset], split: index % 5 === 4 ? 'test' : 'dev', lang, persona: String(spec.persona ?? ''), threads, turns }
      if (!episodes) return session
      // Facts whose text missed a step are left out of the probes: their ground truth is not in the chat.
      const missed = new Set(turns.filter(turn => turn.tags.includes('fact-miss')).map(turn => `${turn.gold.thread}/${turn.fact.key}`))
      const timeline = episodes.timeline.map(event => missed.has(`${event.thread}/${event.key}`) ? { ...event, miss: true } : event)
      const probes = buildProbes(session, timeline.filter(event => !event.miss), seed * 7919 + index)
      return { ...session, fact_types: episodes.types, timeline, probes }
    }
  }
  // One broken session is skipped and recorded rather than losing the whole run.
  const failed = []
  const sessions = (await Promise.all(Array.from({ length: count }, (_, index) => make(index).catch(error => {
    failed.push({ index, error: String(error.message).slice(0, 300) }); log(`session ${index + 1} skipped: ${error.message}`); return null
  })))).filter(Boolean)
  if (out) {
    mkdirSync(out, { recursive: true })
    writeFileSync(join(out, 'sessions.jsonl'), sessions.map(session => JSON.stringify(session)).join('\n') + '\n')
    const messages = sessions.flatMap(session => session.turns)
    writeFileSync(join(out, 'manifest.json'), JSON.stringify({ version: VERSIONS[dataset], model: client.model, seed, sessions: sessions.length,
      failed, messages: messages.length, ambiguous: messages.filter(turn => turn.ambiguous).length, leaks: messages.filter(turn => turn.tags.includes('leak')).length,
      ...(v1 ? { probes: sessions.reduce((sum, session) => sum + session.probes.length, 0), factMisses: messages.filter(turn => turn.tags.includes('fact-miss')).length } : {}),
      options: { langs, minThreads, maxThreads, minTurns, maxTurns, chunk, judge }, usage: { ...client.usage, cost: client.usage.cost }, generatedAt: new Date().toISOString() }, null, 2) + '\n')
  }
  return sessions
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: {
    sessions: { type: 'string', default: '50' }, seed: { type: 'string', default: '1' }, langs: { type: 'string', default: 'zh,en' },
    dataset: { type: 'string', default: 'v1' }, out: { type: 'string' }, 'dry-run': { type: 'boolean', default: false },
    'no-judge': { type: 'boolean', default: false }, model: { type: 'string' } } })
  const dry = values['dry-run']
  const client = await createClient({ model: values.model, cacheDir: join(here, '.cache', dry ? 'fake' : 'llm'), fake: dry ? join(here, 'test', 'fake-model.mjs') : undefined })
  const name = VERSIONS[values.dataset]
  if (!name) throw new Error('--dataset v0|v1')
  const out = dry ? join(here, 'data', `${name}-dry`) : values.out ?? join(here, 'data', name)
  const timer = setInterval(() => console.error(`… ${client.usage}`), 15000)
  try {
    const sessions = await generate({ sessions: Number(values.sessions), seed: Number(values.seed), langs: values.langs.split(','), judge: !values['no-judge'], dataset: values.dataset, out, client, log: line => console.error(line) })
    console.log(`Wrote ${sessions.length} sessions to ${out}`)
    console.log(`Model: ${client.model} · ${client.usage}${dry ? ' (fake model: token counts are estimates, nothing was spent)' : ''}`)
  } finally { clearInterval(timer) }
}

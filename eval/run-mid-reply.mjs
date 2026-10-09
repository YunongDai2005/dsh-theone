#!/usr/bin/env node
// Messages sent while a reply is still running: does TheOne keep them with the running work, or send
// them to the matter they are about? Uses TheOne's own prompt, payload and validation from dist/, and
// the same rule as the plugin: a bare "ok"/"go on" stays, KEEP and CLARIFY stay, anything else goes.
//
//   node eval/run-mid-reply.mjs [--model name] [--dry-run]
//
// Two kinds of mistake are counted apart: "mixed in" (another matter put into the running reply,
// the pollution TheOne exists to avoid) and "split off" (a change to the running work sent elsewhere,
// so the work goes on without it).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { routingPayload, routingPrompt, validateRoutingDecision } from '../dist/llm-router.js'
import { continuesCurrent } from '../dist/routing-policy.js'
import { createClient } from './lib/llm.mjs'

const here = dirname(fileURLToPath(import.meta.url))

/** Where TheOne sends one case: "running", an existing topic id, "new", or "ERROR". */
export async function decideCase(item, contexts, client) {
  const { running, text } = item
  if (continuesCurrent(text)) return { pred: 'running', via: 'fast' }
  const input = { text, contexts, currentId: running.topicId, running,
    recent: [{ role: 'user', text: running.request }, { role: 'assistant', text: running.progress }] }
  const payload = routingPayload(input)
  try {
    const answer = await client.complete({ system: routingPrompt(payload), user: JSON.stringify(payload), maxTokens: 2048, json: true, details: true, tag: `route:mid:${item.id}` })
    const decision = validateRoutingDecision(answer.value, input)
    const pred = decision.action === 'KEEP' || decision.action === 'CLARIFY' ? 'running' : decision.action === 'CREATE' ? 'new' : decision.contextId
    return { pred, via: 'llm', reason: decision.reason, usage: answer.usage }
  } catch (error) {
    // The plugin keeps the message with the running reply when the classifier fails.
    return { pred: 'running', via: 'error', error: String(error?.code ?? error?.message ?? error) }
  }
}

export function score(rows) {
  const n = rows.length
  const elsewhere = row => row.expect !== 'running'
  const right = rows.filter(row => row.pred === row.expect).length
  const sideRight = rows.filter(row => elsewhere(row) === (row.pred !== 'running')).length
  const mixedIn = rows.filter(row => elsewhere(row) && row.pred === 'running')
  const splitOff = rows.filter(row => !elsewhere(row) && row.pred !== 'running')
  const pct = k => n ? `${(100 * k / n).toFixed(1)}%` : '-'
  return { n, exact: right, exactRate: pct(right), side: sideRight, sideRate: pct(sideRight),
    mixedIn: mixedIn.map(row => row.id), splitOff: splitOff.map(row => row.id) }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { data: { type: 'string', default: join(here, 'data', 'mid-reply', 'cases.json') },
    model: { type: 'string' }, 'dry-run': { type: 'boolean', default: false }, out: { type: 'string' } } })
  const dry = values['dry-run']
  const client = await createClient({ model: values.model, cacheDir: join(here, '.cache', dry ? 'fake' : 'llm'), fake: dry ? join(here, 'test', 'fake-model.mjs') : undefined })
  const data = JSON.parse(readFileSync(values.data, 'utf8'))
  const rows = await Promise.all(data.cases.map(async item => ({ id: item.id, how: item.how, text: item.text, expect: item.expect,
    ...await decideCase(item, data.catalogs[item.lang], client) })))
  const out = values.out ?? join(dirname(values.data), 'predictions', `${client.model.replace(/[^\w.-]+/g, '_')}.jsonl`)
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, rows.map(row => JSON.stringify(row)).join('\n') + '\n')
  const result = score(rows)
  console.log(`${result.n} cases · right destination ${result.exact} (${result.exactRate}) · right side (running vs elsewhere) ${result.side} (${result.sideRate})`)
  console.log(`mixed into the running reply: ${result.mixedIn.join(', ') || 'none'}`)
  console.log(`split off from it: ${result.splitOff.join(', ') || 'none'}`)
  for (const row of rows.filter(row => row.pred !== row.expect)) console.log(`  ${row.id} [${row.how}] "${row.text}" → ${row.pred}, expected ${row.expect}${row.error ? ` (${row.error})` : ''}`)
  console.log(`${client.usage}\npredictions: ${out}`)
}

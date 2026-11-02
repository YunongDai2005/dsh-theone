#!/usr/bin/env node
// Isolated entry point for the existing routing-v1 runner. Dry runs never read
// model keys; --live is a deliberate author-only invocation after review.
import { existsSync, realpathSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve, relative, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const here = dirname(fileURLToPath(import.meta.url))
export const PRIVATE_ROOT = resolve(here, 'data/private-real')

function within(path) {
  const full = resolve(path)
  const rel = relative(PRIVATE_ROOT, full)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Private output/input required')
  let parent = full
  while (!existsSync(parent)) parent = dirname(parent)
  const actual = realpathSync(parent)
  const base = existsSync(PRIVATE_ROOT) ? realpathSync(PRIVATE_ROOT) : PRIVATE_ROOT
  const linkRel = relative(base, actual)
  if (linkRel.startsWith('..') || isAbsolute(linkRel)) throw new Error('Private path escapes through a link')
  return full
}

export function options(args) {
  const { values } = parseArgs({ args, options: {
    data: { type: 'string' }, out: { type: 'string' },
    'dry-run': { type: 'boolean', default: false }, live: { type: 'boolean', default: false },
    mode: { type: 'string', default: 'open' }, cards: { type: 'boolean', default: false },
    split: { type: 'string', default: 'dev' }, model: { type: 'string' },
    'state-ablation': { type: 'string', default: 'none' }, limit: { type: 'string' },
  } })
  if (values['dry-run'] === values.live) throw new Error('Choose exactly one of --dry-run or --live')
  if (!values.data || !values.out) throw new Error('--data and a fresh --out are required')
  if (!['dev', 'test', 'all'].includes(values.split) || !['open', 'closed'].includes(values.mode)) throw new Error('Invalid split or mode')
  if (!['none', 'drop-bindings', 'drop-user-refs'].includes(values['state-ablation'])) throw new Error('Invalid state ablation')
  if (values.limit && (!Number.isInteger(Number(values.limit)) || Number(values.limit) < 1)) throw new Error('Invalid session limit')
  const data = within(values.data), out = within(values.out)
  if (existsSync(out) || existsSync(out + '.warmup.jsonl') || existsSync(out + '.cache') || existsSync(out + '.tmp')) throw new Error('Output/cache/temp already exists; use a new output name')
  return { ...values, data, out, cache: out + '.cache', temp: out + '.tmp' }
}

export function prepareReplaySession(session, mode = 'open') {
  const warmup = session.warmup ?? []
  if (warmup.length) {
    if (mode !== 'open' || session.catalog?.length || session.current_id) throw new Error('Warmup requires an empty open catalog')
    const boundary = Date.parse(session.overlap_start)
    if (!Number.isFinite(boundary) || warmup.some(t => !Number.isFinite(Date.parse(t.at)) || Date.parse(t.at) >= boundary ||
      t.gold?.thread !== null || !t.ambiguous || t.input || t.events_before?.length || t.reply ||
      t.i >= session.turns[0]?.i) || session.turns.some(t => Date.parse(t.at) < boundary)) {
      throw new Error('Invalid past-only warmup')
    }
  }
  if (session.observation_basis === 'unavailable_multi_window' && [...warmup, ...session.turns].some(t =>
    t.reply || t.events_before?.length || t.input)) throw new Error('Multi-window data cannot supply foreground observations')
  return { ...session, turns: [...warmup, ...session.turns] }
}

export async function run(config) {
  const environment = Object.fromEntries(['TEMP', 'TMP', 'TMPDIR', 'EVAL_MODEL', 'EVAL_RPM'].map(k => [k, process.env[k]]))
  const originalFetch = globalThis.fetch
  try {
    mkdirSync(dirname(config.out), { recursive: true })
    mkdirSync(config.temp)
    // product-replay uses os.tmpdir(). Set these before loading the product.
    process.env.TEMP = config.temp
    process.env.TMP = config.temp
    process.env.TMPDIR = config.temp
    if (config['dry-run']) {
      // Overwrite possible provider fields without reading their previous values.
      process.env.EVAL_HEADERS = '{}'
      process.env.EVAL_EXTRA_BODY = '{}'
      process.env.EVAL_MODEL = 'private-offline'
      process.env.EVAL_RPM = '0'
      globalThis.fetch = async () => { throw new Error('Network is disabled during private dry run') }
    }
    const { readSessions, routeSession, validatePredictionKeys } = await import('./run-router.mjs')
    const { createClient } = await import('./lib/llm.mjs')
    const { validateRoutingSet } = await import('./lib/routing-v1.mjs')
    const all = readSessions(config.data)
    validateRoutingSet(all)
    let sessions = all.filter(s => config.split === 'all' || s.split === config.split)
    if (config.limit) sessions = sessions.slice(0, Number(config.limit))
    if (!sessions.length) throw new Error('No sessions in selected split')
    const client = await createClient({ model: config['dry-run'] ? 'private-offline' : config.model,
      cacheDir: config.cache, fake: config['dry-run'] ? join(here, 'test/fake-model.mjs') : undefined })
    const rows = [], warmupRows = []
    for (const session of sessions) {
      const replay = prepareReplaySession(session, config.mode)
      const predicted = await routeSession(replay, { client, mode: config.mode, policy: 'theone', cards: config.cards,
        stateAblation: config['state-ablation'], replay: 'product-v1' })
      const scored = new Set(session.turns.map(t => t.i))
      rows.push(...predicted.filter(row => scored.has(row.i)))
      warmupRows.push(...predicted.filter(row => !scored.has(row.i)))
      console.log(JSON.stringify({ completed_sessions: rows.length ? sessions.indexOf(session) + 1 : 0, messages: rows.length, dry_run: config['dry-run'] }))
    }
    validatePredictionKeys(sessions, rows)
    if (warmupRows.length) writeFileSync(config.out + '.warmup.jsonl', warmupRows.map(row => JSON.stringify({ ...row, private_real: true, dry_run: config['dry-run'], warmup: true })).join('\n') + '\n', { flag: 'wx' })
    writeFileSync(config.out, rows.map(row => JSON.stringify({ ...row, private_real: true, dry_run: config['dry-run'] })).join('\n') + '\n', { flag: 'wx' })
    console.log(JSON.stringify({ status: 'complete', sessions: sessions.length, messages: rows.length, warmup_messages: warmupRows.length,
      dry_run: config['dry-run'], transport: config['dry-run'] ? 'fake-in-process-no-network' : 'author-configured' }))
    return rows
  } finally {
    for (const [key, value] of Object.entries(environment)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    globalThis.fetch = originalFetch
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await run(options(process.argv.slice(2))) }
  catch (error) {
    // Never print raw parser/provider errors or user text to terminal logs.
    console.error(JSON.stringify({ status: 'failed', error_type: error?.name ?? 'Error', code: error?.code ?? null,
      detail: 'Inspect environment and private input; no raw error text logged.' }))
    process.exitCode = 1
  }
}
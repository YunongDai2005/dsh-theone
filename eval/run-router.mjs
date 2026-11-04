#!/usr/bin/env node
// product-v1 runs the actual DSH/TheOne gateway. The earlier partial simulation
// is available explicitly as legacy-v0 and carries a different scoring protocol.
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { isRoutingV1 } from './lib/routing-v1.mjs'
import { createClient } from './lib/llm.mjs'
import { routingVariant } from '../dist/routing-experiments.js'
import { routeSession as productSession, validatePredictionKeys } from './lib/product-replay.mjs'
import { routeSession as legacySession, readSessions } from './run-router-legacy.mjs'
export { readSessions, validatePredictionKeys }
export { batchDecisions, BATCH_PROMPT } from './run-router-legacy.mjs'

export async function routeSession(session, options = {}) {
  const replay = options.replay ?? 'product-v1'
  const variant = routingVariant(options.variant)
  const cacheSalt = options.cacheSalt ?? options['cache-salt']
  if (replay !== 'product-v1' && (variant !== 'none' || cacheSalt !== undefined)) throw new Error('Cache variants/salt require product-v1')
  if (!['product-v1', 'legacy-v0'].includes(replay)) throw new Error('--replay product-v1|legacy-v0')
  if (!isRoutingV1(session) && options.stateAblation && options.stateAblation !== 'none') throw new Error('state ablation requires routing-v1')
  if (isRoutingV1(session) && replay !== 'product-v1') throw new Error('routing-v1 requires product-v1 replay')
  const rows = await (replay === 'product-v1' ? productSession(session, { ...options, variant, cacheSalt }) : legacySession(session, options))
  validatePredictionKeys([session], rows)
  return rows.map(row => ({ ...row, replay, variant, ...(cacheSalt === undefined ? {} : { cache_salt: cacheSalt }) }))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const here = dirname(fileURLToPath(import.meta.url))
  const { values } = parseArgs({ options: {
    data: { type: 'string', default: join(here, 'data', 'interleave-v0', 'sessions.jsonl') },
    replay: { type: 'string', default: 'product-v1' }, mode: { type: 'string', default: 'closed' },
    policy: { type: 'string', default: 'theone' }, split: { type: 'string', default: 'dev' },
    model: { type: 'string' }, out: { type: 'string' }, 'dry-run': { type: 'boolean', default: false }, limit: { type: 'string' },
    merge: { type: 'string', default: 'none' }, decide: { type: 'string', default: 'joint' },
    same: { type: 'string', default: '0.35' }, cross: { type: 'string', default: '0.05' }, 'burst-seed': { type: 'string', default: '1' },
    'state-ablation': { type: 'string', default: 'none' },
    variant: { type: 'string', default: 'none' }, 'cache-salt': { type: 'string' },
    cards: { type: 'boolean', default: false }, recheck: { type: 'boolean', default: false } } })
  if (!['product-v1', 'legacy-v0'].includes(values.replay)) throw new Error('--replay product-v1|legacy-v0')
  if (!['open', 'closed'].includes(values.mode) || !['llm', 'theone'].includes(values.policy)) throw new Error('--mode open|closed, --policy llm|theone')
  if (values.replay === 'product-v1' && (values.policy !== 'theone' || values.merge !== 'none' || values.decide !== 'joint'))
    throw new Error('Product replay uses --policy theone --merge none --decide joint; ablations require --replay legacy-v0')
  routingVariant(values.variant)
  if (values.replay !== 'product-v1' && (values.variant !== 'none' || values['cache-salt'] !== undefined)) throw new Error('Cache variants/salt require product-v1')
  let sessions = readSessions(values.data).filter(session => values.split === 'all' || session.split === values.split)
  if (values.limit) sessions = sessions.slice(0, Number(values.limit))
  validatePredictionKeys(sessions, sessions.flatMap(session => session.turns.map(turn => ({ session_id: session.session_id, i: turn.i, pred: 'pending' }))))
  const dry = values['dry-run']
  const client = await createClient({ model: values.model, cacheDir: join(here, '.cache', values.replay, dry ? 'fake' : 'llm'),
    fake: dry ? join(here, 'test', 'fake-model.mjs') : undefined })
  const name = `${values.replay}-${values.mode}-${values.policy}${values.cards ? '-cards' : ''}-${client.model.replace(/[^\w.-]+/g, '_')}`
  const suffix = values['state-ablation'] === 'none' ? '' : '-' + values['state-ablation']
  const out = values.out ?? join(dirname(values.data), 'predictions', `${name}${suffix}${values.variant === 'none' ? '' : '-' + values.variant}.jsonl`)
  if (sessions.some(isRoutingV1) && existsSync(out)) throw new Error('Refusing to overwrite routing-v1 predictions: ' + out)
  const rows = []
  // Keep temporary databases/runtimes bounded as well as HTTP concurrency.
  for (let offset = 0; offset < sessions.length; offset += 4) {
    const batch = await Promise.all(sessions.slice(offset, offset + 4).map(session => routeSession(session, { ...values, client, stateAblation: values['state-ablation'],
      bursts: { same: Number(values.same), cross: Number(values.cross), seed: Number(values['burst-seed']) } })))
    rows.push(...batch.flat())
    console.error(`${Math.min(offset + 4, sessions.length)}/${sessions.length} sessions · ${client.usage}`)
  }
  validatePredictionKeys(sessions, rows)
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, rows.map(row => JSON.stringify(row)).join('\n') + '\n')
  console.log(`Routed ${rows.length} messages (${values.replay}) → ${out}`)
}

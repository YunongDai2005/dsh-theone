import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve, join, relative, isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'
const launcher = resolve('eval/run-private-real.mjs')
let module
if (existsSync(launcher)) module = await import(pathToFileURL(launcher).href)
const privateRoot = resolve('eval/data/private-real')

test('requires an explicit execution mode before constructing a model client', () => {
  assert.ok(module, 'private launcher is missing')
  assert.throws(() => module.options(['--data', join(privateRoot, 'fiction.jsonl'), '--out', join(privateRoot, 'result.jsonl')]))
  assert.throws(() => module.options(['--dry-run', '--live']))
})

test('rejects public data or prediction paths', () => {
  assert.ok(module, 'private launcher is missing')
  for (const args of [
    ['--data', 'eval/test/synthetic.jsonl', '--out', join(privateRoot, 'fiction.jsonl')],
    ['--data', join(privateRoot, 'fiction.jsonl'), '--out', 'eval/public.jsonl'],
  ]) assert.throws(() => module.options(['--dry-run', ...args]))
})

test('never overwrites an earlier prediction file', () => {
  assert.ok(module, 'private launcher is missing')
  const dir = join(privateRoot, `synthetic-node-${process.pid}`)
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'prediction.jsonl')
  try {
    writeFileSync(file, '{}\n', { flag: 'wx' })
    assert.throws(() => module.options(['--dry-run', '--data', join(dir, 'data.jsonl'), '--out', file]))
  } finally {
    const rel = relative(privateRoot, resolve(dir))
    assert.ok(rel && !rel.startsWith('..') && !isAbsolute(rel))
    rmSync(dir, { recursive: true, force: true })
  }
})

test('private dry run retains open/cards and a separate cache and temporary root', () => {
  assert.ok(module, 'private launcher is missing')
  const args = module.options(['--dry-run', '--data', join(privateRoot, 'fiction.jsonl'), '--out', join(privateRoot, 'fiction-out.jsonl'), '--mode', 'open', '--cards', '--split', 'test'])
  assert.equal(args.mode, 'open')
  assert.equal(args.cards, true)
  assert.equal(args.split, 'test')
  assert.equal(args['dry-run'], true)
  assert.ok(args.cache.startsWith(privateRoot))
  assert.ok(args.temp.startsWith(privateRoot))
})
function fixture() {
  const gold = thread => ({ thread, action: 'continue', refs: [], explicit_binding: false, retract: [] })
  return { version: 'interleave-v1', routing_schema: 'routing-v1', benchmark_revision: 'private-real-2',
    session_id: 'fiction-warmup', split: 'dev', lang: 'en', catalog: [],
    observation_basis: 'unavailable_multi_window', overlap_start: '2026-01-01T00:02:00.000Z',
    threads: [{ id: 't1', title: 'Fictional telescope', description: 'A fictional telescope plan.' }],
    warmup: [{ i: 0, at: '2026-01-01T00:00:00.000Z', text: 'Plan a fictional blue telescope with an adjustable mount.',
      reply: '', events_before: [], gold: gold(null), tags: ['warmup'], ambiguous: true }],
    turns: [{ i: 1, at: '2026-01-01T00:03:00.000Z', text: 'Adjust the fictional blue telescope mount for the garden.',
      reply: '', events_before: [], gold: gold('t1'), tags: [], ambiguous: false }],
  }
}

test('expands past warmup without seeding topic ids and rejects future or visible context', () => {
  assert.equal(typeof module.prepareReplaySession, 'function')
  const source = fixture()
  const expanded = module.prepareReplaySession(source, 'open')
  assert.equal(expanded.turns.length, 2)
  assert.deepEqual(expanded.catalog, [])
  assert.equal(source.turns.length, 1)
  assert.throws(() => module.prepareReplaySession(source, 'closed'))
  for (const bad of [
    { ...source, catalog: [{ id: 't1' }] },
    { ...source, warmup: [{ ...source.warmup[0], at: source.overlap_start }] },
    { ...source, turns: [{ ...source.turns[0], reply: 'An unobserved foreground answer' }] },
  ]) assert.throws(() => module.prepareReplaySession(bad, 'open'))
})

test('dry product replay establishes topics from warmup but writes only scored predictions', async () => {
  assert.equal(typeof module.prepareReplaySession, 'function')
  const dir = join(privateRoot, `synthetic-warmup-${process.pid}`)
  mkdirSync(dir, { recursive: true })
  const data = join(dir, 'data.jsonl'), out = join(dir, 'predictions.jsonl')
  try {
    writeFileSync(data, JSON.stringify(fixture()) + '\n', { flag: 'wx' })
    const rows = await module.run(module.options(['--dry-run', '--cards', '--data', data, '--out', out]))
    assert.deepEqual(rows.map(row => row.i), [1])
    assert.notEqual(rows[0].pred, 'ERROR')
    assert.ok(rows[0].state_before.topics.length > 0)
    assert.equal(rows[0].receipt_missing, false)
    assert.deepEqual(rows[0].events, [])
    assert.ok(existsSync(out + '.warmup.jsonl'))
  } finally {
    const rel = relative(privateRoot, resolve(dir))
    assert.ok(rel && !rel.startsWith('..') && !isAbsolute(rel))
    rmSync(dir, { recursive: true, force: true })
  }
})

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
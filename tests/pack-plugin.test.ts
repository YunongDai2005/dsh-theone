import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('the release archive includes ongoing-task documentation and excludes local data', { timeout: 30000 }, async () => {
  const target = await mkdtemp(join(tmpdir(), 'theone-release-test-'))
  try {
    const { packPlugin } = await import('../scripts/' + 'pack-plugin.mjs')
    const result = await packPlugin(target)
    const paths = result.files.map((file: { path: string }) => file.path) as string[]
    for (const path of ['docs/persistent-work.md', 'dist/persistent-work.js', 'dist/work-store.js', 'dist/client.js']) assert.ok(paths.includes(path), path)
    assert.ok(paths.every(path => !/^\.(?:dsh|workbuddy)|^tests\/|Readme\.txt$/i.test(path)))
  } finally { await rm(target, { recursive: true, force: true }) }
})

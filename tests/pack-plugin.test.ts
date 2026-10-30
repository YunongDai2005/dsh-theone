import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

test('engines.dsh accepts every DSH 0.2 release, so a DSH update does not mark TheOne incompatible', () => {
  // DSH reads engines.dsh before peerDependencies and compares with prereleases included (dsh-app-boot).
  const boot = import.meta.resolve('@deepseek-ai/dsh-app-boot')
  const semver = createRequire(boot)('semver') as { satisfies(version: string, range: string, options: { includePrerelease: boolean }): boolean }
  const range = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { engines: { dsh: string } }).engines.dsh
  const accepts = (version: string) => semver.satisfies(version, range, { includePrerelease: true })
  const current = (createRequire(boot)('@deepseek-ai/dsh-app-boot/package.json') as { version: string }).version
  for (const version of [current, '0.2.0-rc.2', '0.2.1-rc.2', '0.2.1-rc.3', '0.2.1', '0.2.4-beta.1']) assert.ok(accepts(version), version)
  for (const version of ['0.2.0-rc.1', '0.3.0-alpha.1', '0.3.0']) assert.ok(!accepts(version), version)
})

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

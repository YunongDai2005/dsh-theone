import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compareVersions, installSource, Updater, type PluginInstaller } from '../src/update.ts'

const SHA = 'a'.repeat(40)
function github(version: string, calls: string[] = []): typeof fetch {
  return (async (url: string | URL) => {
    calls.push(String(url))
    if (String(url).includes('api.github.com')) return new Response(SHA)
    return Response.json({ version })
  }) as typeof fetch
}

test('versions compare numerically and installs are traced to their source', () => {
  assert.equal(compareVersions('0.3.10', '0.3.9'), 1)
  assert.equal(compareVersions('v0.4.0', '0.4.0'), 0)
  assert.equal(compareVersions('0.4.0-rc.1', '0.4.0'), -1)
  assert.equal(installSource('github:YunongDai2005/dsh-theone'), 'github')
  assert.equal(installSource('git+https://github.com/YunongDai2005/dsh-theone.git#abc'), 'github')
  assert.equal(installSource('^0.3.9'), 'npm')
  assert.equal(installSource('file:../dsh-theone'), 'other')
  assert.equal(installSource(undefined), 'other')
})

test('a GitHub install updates to the exact commit it checked, through the plugin manager', async () => {
  const calls: string[] = []
  let time = 0
  const updater = new Updater('0.3.10', () => 'github:YunongDai2005/dsh-theone', github('0.3.11', calls), () => time)
  const status = await updater.status()
  assert.deepEqual(status, { current: '0.3.10', latest: '0.3.11', available: true, installable: true, source: 'github' })
  assert.ok(calls[1].endsWith(`/${SHA}/package.json`))
  // Checks are cached for six hours unless forced.
  await updater.status(); assert.equal(calls.length, 2)
  await updater.status(true); assert.equal(calls.length, 4)
  time += 7 * 3600000; await updater.status(); assert.equal(calls.length, 6)
  const specs: string[] = []
  const installer: PluginInstaller = { installBundle: async (spec, options) => { specs.push(spec); assert.equal(options?.enabled, true); return { application: 'restart-required' } } }
  assert.equal((await updater.install(installer)).state, 'restart')
  assert.deepEqual(specs, [`github:YunongDai2005/dsh-theone#${SHA}`])
  // Installed once; it waits for the restart rather than installing again.
  await updater.install(installer); assert.equal(specs.length, 1)
})

test('npm installs use the registry; nothing newer, offline or unmanaged installs are handled', async () => {
  const npm = new Updater('0.3.10', () => '^0.3.10', (async () => Response.json({ version: '0.4.0' })) as typeof fetch)
  const specs: string[] = []
  const status = await npm.install({ installBundle: async spec => { specs.push(spec); return { application: 'failed', error: { code: 'incompatible-version' } } } })
  assert.deepEqual(specs, ['dsh-theone@0.4.0'])
  assert.equal(status.state, 'failed')
  assert.equal(status.error, 'incompatible-version')

  const current = new Updater('0.3.11', () => 'github:YunongDai2005/dsh-theone', github('0.3.11'))
  assert.equal((await current.status()).available, false)

  const offline = new Updater('0.3.10', () => 'github:YunongDai2005/dsh-theone', (async () => { throw new Error('getaddrinfo ENOTFOUND') }) as typeof fetch)
  const unreachable = await offline.status()
  assert.equal(unreachable.available, false)
  assert.match(unreachable.error!, /ENOTFOUND/)

  const local = new Updater('0.3.10', () => 'file:../dsh-theone', github('0.3.11'))
  const manual = await local.status()
  assert.equal(manual.available, true)
  assert.equal(manual.installable, false)
  assert.equal((await local.install({ installBundle: async () => assert.fail('must not install') })).state, undefined)
  // Without DSH's plugin manager nothing is installed either.
  const missing = new Updater('0.3.10', () => '^0.3.10', (async () => Response.json({ version: '0.4.0' })) as typeof fetch)
  assert.equal((await missing.install(undefined)).state, undefined)
})

test('with hot reload, TheOne reloads itself after installing instead of waiting for a DSH restart', async () => {
  const updater = new Updater('0.3.10', () => 'github:YunongDai2005/dsh-theone', github('0.3.11'))
  const reloaded: string[] = []
  const status = await updater.install({ installBundle: async () => ({ application: 'restart-required', bundle: 'dsh-theone' }) }, bundle => reloaded.push(bundle))
  assert.equal(status.state, 'reloading')
  assert.deepEqual(reloaded, ['dsh-theone'])
  await updater.install({ installBundle: async () => assert.fail('installed once') }, bundle => reloaded.push(bundle))
  assert.equal(reloaded.length, 1)
})

test('the update endpoint installs, then switches the bundle off and on so DSH loads the new version', { timeout: 30000 }, async () => {
  const { mkdtemp, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { HostConnectionService } = await import('@deepseek-ai/dsh-client-connection')
  const { harness } = await import('./harness.ts')
  const root = await mkdtemp(join(tmpdir(), 'theone-update-'))
  const previousFetch = globalThis.fetch
  const app = await harness(root)
  try {
    const calls: string[] = []
    const manager = {
      installBundle: async (spec: string) => { calls.push(`install ${spec}`); return { application: 'restart-required', bundle: 'dsh-theone' } },
      setBundleEnabled: async (name: string, enabled: boolean) => { calls.push(`${enabled ? 'on' : 'off'} ${name}`); return { application: 'applied' } },
    }
    app.ctx.provide('pluginManager'); app.ctx.set('pluginManager', manager)
    app.ctx.provide('hmr'); app.ctx.set('hmr', {})
    // This copy reports itself as installed from GitHub, one version behind.
    Object.defineProperty(app.ctx.theone, 'updater', { value: new Updater('0.0.1', () => 'github:YunongDai2005/dsh-theone', github('9.9.9')) })
    const connection = new HostConnectionService(app.ctx, [], undefined as never)
    const handler = connection.createSharedFetchHandler('/api')
    await new Promise<void>(resolve => setImmediate(resolve))
    const checked = await (await handler.fetch(new Request('http://dsh.internal/api/theone/update'))).json() as { available: boolean }
    assert.equal(checked.available, true)
    const response = await handler.fetch(new Request('http://dsh.internal/api/theone/update', { method: 'POST' }))
    assert.equal((await response.json() as { state: string }).state, 'reloading')
    await new Promise(resolve => setTimeout(resolve, 600))
    assert.deepEqual(calls, [`install github:YunongDai2005/dsh-theone#${SHA}`, 'off dsh-theone', 'on dsh-theone'])
  } finally { globalThis.fetch = previousFetch; await app.close(); await rm(root, { recursive: true, force: true }) }
})

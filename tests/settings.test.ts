import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import { FixtureModel, harness } from './harness.ts'
import type { SettingsSnapshot } from '../src/settings-types.ts'

class CapacityModel extends FixtureModel {
  override async resolveModel(provider: string, model: string) {
    return { provider, id: model, name: model, context: { contextWindow: 16384 }, defaultMaxTokens: 512 }
  }
}

test('settings expose all public runtime options without credentials, writes or generation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-settings-'))
  const previous = process.env.THEONE_SETTINGS_SECRET_TEST
  const secret = 'settings-private-credential-example'
  process.env.THEONE_SETTINGS_SECRET_TEST = secret
  const model = new CapacityModel()
  const app = await harness(root, model, { theoneConfig: {
    routerBaseUrl: `https://username:${secret}@example.com/v1?api_key=${secret}#${secret}`,
    routerApiKeyEnv: 'THEONE_SETTINGS_SECRET_TEST', catalogIntervalMs: 45000,
  } })
  try {
    const connection = new HostConnectionService(app.ctx, [], undefined as never)
    const handler = connection.createSharedFetchHandler('/api')
    await new Promise<void>(resolve => setImmediate(resolve))
    const before = app.gateway.session.snapshotEvents()
    const request = () => handler.fetch(new Request('http://dsh.internal/api/theone/settings'))
    const response = await request()
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    const settings: SettingsSnapshot = await response.json()
    assert.equal(Object.keys(settings.values).length, 16)
    assert.equal(settings.values.catalogIntervalMs, 45000)
    assert.equal(settings.values.routerBaseUrl, 'https://example.com/v1')
    assert.equal(settings.values.routerApiKeyEnv, 'THEONE_SETTINGS_SECRET_TEST')
    assert.equal(JSON.stringify(settings).includes(secret), false)
    assert.equal(JSON.stringify(settings).includes('username'), false)
    assert.equal(settings.model?.contextWindow, 16384)
    assert.equal(settings.model?.defaultMaxTokens, 512)
    assert.equal(settings.modelUnavailable, false)
    assert.deepEqual(app.gateway.session.snapshotEvents(), before)
    assert.equal(model.requests.length, 0)
    assert.notEqual((await handler.fetch(new Request('http://dsh.internal/api/theone/settings', { method: 'POST' }))).status, 200)
    await app.close()
    assert.equal((await request()).status, 404)
  } finally {
    await app.close(); await rm(root, { recursive: true, force: true })
    if (previous === undefined) delete process.env.THEONE_SETTINGS_SECRET_TEST
    else process.env.THEONE_SETTINGS_SECRET_TEST = previous
  }
})

test('settings follow a remembered DSH model and remain readable when metadata is unavailable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-settings-model-'))
  const app = await harness(root, new CapacityModel(), { autoModel: true, defaultProvider: 'theone' })
  try {
    assert.equal((await app.ctx.theone.settingsSnapshot()).model, null)
    app.ctx.theone.store.rememberModel('test-gateway', { provider: 'fixture', model: 'fixture' })
    let settings = await app.ctx.theone.settingsSnapshot()
    assert.equal(settings.model?.contextWindow, 16384)
    assert.equal(settings.values.workerProvider, null)
    app.ctx.theone.store.rememberModel('test-gateway', { provider: 'unavailable', model: 'offline' })
    settings = await app.ctx.theone.settingsSnapshot()
    assert.equal(settings.modelUnavailable, true)
    assert.equal(settings.model?.model, 'offline')
    assert.equal(settings.values.maxDescriptorChars, 4000)
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('settings save atomically, reject stale or invalid forms, and apply only after restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-settings-save-'))
  let app = await harness(root, new CapacityModel())
  const connect = async () => {
    const connection = new HostConnectionService(app.ctx, [], undefined as never)
    const handler = connection.createSharedFetchHandler('/api')
    await new Promise<void>(resolve => setImmediate(resolve))
    return (values: unknown, revision: number) => handler.fetch(new Request('http://dsh.internal/api/theone/settings', {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ values, revision }),
    }))
  }
  try {
    let put = await connect()
    const initial = await app.ctx.theone.settingsSnapshot()
    const desired = { ...initial.savedValues, routerMode: 'llm', routerTransport: 'dsh', maxResponseChars: 12345,
      workerProvider: null, workerModel: null, routerBaseUrl: 'https://api.deepseek.com' }
    for (const invalid of [
      { ...desired, databasePath: '/another/database.db' }, { ...desired, maxResponseChars: 127 },
      { ...desired, historyCatalog: 'false' }, { ...desired, routerMode: 'unknown' },
      { ...desired, workerProvider: 'theone', workerModel: 'gateway' },
      { ...desired, workerProvider: 'fixture', workerModel: null },
      { ...desired, routerBaseUrl: 'https://user:password@example.com' },
      { ...desired, routerBaseUrl: 'https://example.com?key=secret' },
      { ...desired, routerBaseUrl: 'http://example.com/v1' },
      { ...desired, routerApiKeyEnv: 'actual-secret-value!' },
      { ...desired, apiKey: 'private-key' },
      { ...desired, routerTransport: 'legacy', routerApiKeyEnv: 'THEONE_TEST_MISSING_SETTINGS_KEY' },
    ]) assert.equal((await put(invalid, 0)).status, 400)
    assert.equal((await app.ctx.theone.settingsSnapshot()).revision, 0)
    assert.equal((await put(desired, 9)).status, 409)
    const saved = await put(desired, 0)
    assert.equal(saved.status, 200)
    const pending: SettingsSnapshot = await saved.json()
    assert.equal(pending.revision, 1)
    assert.equal(pending.values.routerMode, 'rules')
    assert.equal(pending.savedValues.routerMode, 'llm')
    assert.equal(pending.restartRequired, true)
    assert.equal((await put({ ...desired, maxResponseChars: 54321 }, 0)).status, 409)
    assert.equal((await app.ctx.theone.settingsSnapshot()).savedValues.maxResponseChars, 12345)
    await app.close()
    app = await harness(root, new CapacityModel())
    put = await connect()
    const restarted = await app.ctx.theone.settingsSnapshot()
    assert.equal(restarted.values.routerMode, 'llm')
    assert.equal(restarted.values.routerTransport, 'dsh')
    assert.equal(restarted.values.maxResponseChars, 12345)
    assert.equal(restarted.values.workerProvider, null)
    assert.equal(restarted.restartRequired, false)
    assert.equal(restarted.revision, 1)
    assert.equal((await put(restarted.savedValues, 1)).status, 200)
    assert.equal((await app.ctx.theone.settingsSnapshot()).restartRequired, false)
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('saved settings whose legacy router cannot start fall back to the deployment configuration', async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-settings-fallback-'))
  let app = await harness(root, new CapacityModel())
  try {
    const initial = await app.ctx.theone.settingsSnapshot()
    process.env.THEONE_TEST_REMOVED_KEY = 'present-at-save-time'
    assert.ok(app.ctx.theone.store.saveSettings('test-gateway',
      { ...initial.savedValues, routerMode: 'llm', routerTransport: 'legacy', routerApiKeyEnv: 'THEONE_TEST_REMOVED_KEY' }, 0))
    await app.close()
    delete process.env.THEONE_TEST_REMOVED_KEY
    app = await harness(root, new CapacityModel())
    const restarted = await app.ctx.theone.settingsSnapshot()
    assert.equal(restarted.values.routerMode, 'rules')
    assert.equal(restarted.savedValues.routerTransport, 'legacy')
    assert.equal(restarted.restartRequired, true)
  } finally { delete process.env.THEONE_TEST_REMOVED_KEY; await app.close(); await rm(root, { recursive: true, force: true }) }
})

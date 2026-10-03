import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import { FixtureModel, ask, harness } from './harness.ts'
import type { SettingsSnapshot } from '../src/settings-types.ts'

class CapacityModel extends FixtureModel {
  override async resolveModel(provider: string, model: string) {
    return { provider, id: model, name: model, context: { contextWindow: 16384 }, defaultMaxTokens: 512 }
  }
  override async listModels(provider: string) {
    return [{ provider, id: 'fixture', name: 'Fixture' }, { provider, id: 'fixture-b', name: 'Fixture B' }]
  }
}

test('settings expose all public runtime options without credentials, writes or generation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-settings-'))
  const previous = process.env.THEONE_SETTINGS_SECRET_TEST
  const secret = 'settings-private-credential-example'
  process.env.THEONE_SETTINGS_SECRET_TEST = secret
  const model = new CapacityModel()
  const app = await harness(root, model, { theoneConfig: { catalogIntervalMs: 45000,
    // Retired settings of the removed direct router still load and are never shown.
    routerTransport: 'legacy', routerBaseUrl: `https://username:${secret}@example.com/v1`, routerApiKeyEnv: 'THEONE_SETTINGS_SECRET_TEST' } })
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
    assert.equal(Object.keys(settings.values).length, 13)
    assert.equal(settings.values.catalogIntervalMs, 45000)
    // Every model DSH offers can be picked, except TheOne's own entry.
    assert.deepEqual(settings.models, [{ provider: 'fixture', id: 'fixture', name: 'Fixture' }, { provider: 'fixture', id: 'fixture-b', name: 'Fixture B' }])
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

test('settings save atomically, reject stale or invalid forms, and apply when saved', async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-settings-save-'))
  const model = new CapacityModel()
  let app = await harness(root, model)
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
    const catalogFile = join(root, 'manual.json')
    await writeFile(catalogFile, JSON.stringify([{ id: 'manual-topic', title: '手工话题', summary: '人工整理', entities: ['手工'], keywords: [], lastState: '待开始' }]))
    const desired = { ...initial.savedValues, maxResponseChars: 12345, routeNotice: 'all', linkScope: 'off',
      workerProvider: 'fixture', workerModel: 'fixture-b', catalogIntervalMs: 120000, contextsPath: catalogFile }
    for (const invalid of [
      { ...desired, databasePath: '/another/database.db' }, { ...desired, gatewayKey: 'another' }, { ...desired, maxResponseChars: 127 },
      { ...desired, historyCatalog: 'false' }, { ...desired, routerMode: 'unknown' },
      { ...desired, workerProvider: 'theone', workerModel: 'gateway' },
      { ...desired, workerProvider: 'fixture', workerModel: null },
      { ...desired, contextsPath: join(root, 'missing.json') }, { ...desired, contextsPath: '' },
      { ...desired, apiKey: 'private-key' },
    ]) assert.equal((await put(invalid, 0)).status, 400)
    assert.equal((await app.ctx.theone.settingsSnapshot()).revision, 0)
    assert.equal((await put(desired, 9)).status, 409)
    const saved = await put(desired, 0)
    assert.equal(saved.status, 200)
    const applied: SettingsSnapshot = await saved.json()
    assert.equal(applied.revision, 1)
    // Everything but the background catalog applies at once.
    assert.equal(applied.values.maxResponseChars, 12345)
    assert.equal(applied.values.routeNotice, 'all')
    assert.equal(applied.values.linkScope, 'off')
    assert.equal(applied.values.workerModel, 'fixture-b')
    assert.equal(applied.values.contextsPath, catalogFile)
    assert.equal(applied.values.catalogIntervalMs, 60000)
    assert.equal(applied.restartRequired, true)
    assert.ok(app.ctx.theone.store.contexts().some(context => context.id === 'manual-topic'))
    const reply = await ask(app.gateway, 'Qwen 的配置')
    assert.equal(reply.output, '模拟回答：ctx_qwen_9070xt')
    assert.equal(model.requests.at(-1)?.model, 'fixture-b')
    assert.ok(reply.events.some(event => event.type === 'user/message' && event.data.source.kind === 'theone-route'))
    assert.equal((await put({ ...desired, maxResponseChars: 54321 }, 0)).status, 409)
    assert.equal((await app.ctx.theone.settingsSnapshot()).savedValues.maxResponseChars, 12345)
    await app.close()
    app = await harness(root, new CapacityModel())
    put = await connect()
    const restarted = await app.ctx.theone.settingsSnapshot()
    assert.equal(restarted.values.catalogIntervalMs, 120000)
    assert.equal(restarted.values.maxResponseChars, 12345)
    assert.equal(restarted.values.contextsPath, catalogFile)
    assert.equal(restarted.restartRequired, false)
    assert.equal(restarted.revision, 1)
    assert.equal((await put({ ...restarted.savedValues, contextsPath: null, routerMode: 'llm' }, 1)).status, 200)
    const cleared = await app.ctx.theone.settingsSnapshot()
    assert.equal(cleared.values.contextsPath, null)
    assert.equal(cleared.values.routerMode, 'llm')
    assert.equal(cleared.restartRequired, false)
    // Clearing the file keeps the topics it imported.
    assert.ok(app.ctx.theone.store.contexts().some(context => context.id === 'manual-topic'))
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('saved settings load with retired keys, and an unreadable saved catalog file does not stop TheOne', async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-settings-fallback-'))
  let app = await harness(root, new CapacityModel())
  try {
    const initial = await app.ctx.theone.settingsSnapshot()
    assert.ok(app.ctx.theone.store.saveSettings('test-gateway', { ...initial.savedValues, maxResponseChars: 4321,
      contextsPath: join(root, 'deleted.json'), routerTransport: 'legacy', routerApiKeyEnv: 'THEONE_TEST_REMOVED_KEY' } as never, 0))
    await app.close()
    app = await harness(root, new CapacityModel())
    const restarted = await app.ctx.theone.settingsSnapshot()
    assert.equal(restarted.values.maxResponseChars, 4321)
    assert.equal(restarted.restartRequired, false)
    assert.equal('routerTransport' in restarted.savedValues, false)
    assert.ok(app.ctx.theone.store.saveSettings('test-gateway', { ...initial.savedValues, maxResponseChars: 5 }, 1))
    await app.close()
    app = await harness(root, new CapacityModel())
    assert.equal((await app.ctx.theone.settingsSnapshot()).values.maxResponseChars, 100000)
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('pinning the background model tells DSH to re-read main chat\'s model details', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-settings-signal-'))
  const app = await harness(root, new CapacityModel(), { autoModel: true })
  try {
    let updates = 0
    const on = app.ctx.on.bind(app.ctx) as unknown as (name: string, listener: () => void) => void
    on('llm/adapters-updated', () => { updates++ })
    const connection = new HostConnectionService(app.ctx, [], undefined as never)
    const handler = connection.createSharedFetchHandler('/api')
    await new Promise<void>(resolve => setImmediate(resolve))
    const put = async (values: unknown, revision: number) => handler.fetch(new Request('http://dsh.internal/api/theone/settings', {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ values, revision }) }))
    const initial = await app.ctx.theone.settingsSnapshot()
    assert.equal((await put({ ...initial.savedValues, maxResponseChars: 5000 }, 0)).status, 200)
    assert.equal(updates, 0)
    assert.equal((await put({ ...initial.savedValues, maxResponseChars: 5000, workerProvider: 'fixture', workerModel: 'fixture-b' }, 1)).status, 200)
    assert.equal(updates, 1)
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

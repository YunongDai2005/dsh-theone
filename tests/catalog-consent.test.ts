import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { SessionId } from '@deepseek-ai/dsh-session'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import Storage from '@deepseek-ai/dsh-storage'
import * as JsonStorage from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import { HistoryCatalog, CATALOG_PROMPT, withinCatalogFolder } from '../src/history-catalog.ts'
import { ContextStore } from '../src/store.ts'
import { harness, ask, FixtureModel, textResponse, peered } from './harness.ts'

function fixture() {
  const model = new FixtureModel()
  model.behavior = async function* (options) {
    if (options.system !== CATALOG_PROMPT) { yield* textResponse('Done'); return }
    const payload = JSON.parse(options.messages[0].content.filter(b => b.type === 'text').map(b => b.text).join(''))
    yield* textResponse(JSON.stringify({ topics: [{ contextId: null, title: 'Imported topic', summary: 'History', entities: [], keywords: [],
      lastState: 'In progress', turns: payload.turns.map((turn: { seq: number }) => turn.seq), groupId: null, groupTitle: 'History', groupSummary: '' }] }))
  }
  return model
}
async function source(app: Awaited<ReturnType<typeof harness>>, cwd: string, text = 'Public history') {
  const { agent } = await app.ctx.agents.create({ sessionId: SessionId(randomUUID()), meta: { cwd }, agentOptions: { provider: 'fixture', model: 'fixture' } })
  assert.equal((await ask(agent, text)).end?.data.reason.kind, 'completed')
  return agent
}
async function setup(enabled = false) {
  const root = await mkdtemp(join(tmpdir(), 'theone-consent-'))
  const app = await harness(root, fixture(), { historyCatalog: enabled })
  const store = app.ctx.theone.store
  store.rememberGateway('test-gateway', app.gateway.id)
  const catalog = app.ctx.theone.catalog ?? new HistoryCatalog(app.ctx, store, () => ({ provider: 'fixture', model: 'fixture' }), 60000, 64, true)
  const close = async () => { await catalog.close(); await app.close(); await rm(root, { recursive: true, force: true }) }
  return { ...app, root, store, catalog, close }
}

test('askFirst never reads or indexes user histories before consent, while own sessions and reconciliation still work', async () => {
  const app = await setup()
  try {
    const a = await source(app, app.root), b = await source(app, app.root)
    app.store.rememberGateway('test-gateway', app.gateway.id)
    const owned = app.store.contexts()[0]
    await app.ctx.agents.create({ sessionId: SessionId(owned.workingSessionId), meta: { cwd: app.root }, agentOptions: { provider: 'fixture', model: 'fixture' } })
    app.store.seed([{ id: 'lost', title: 'Lost', summary: '', entities: [], keywords: [], lastState: '' }])
    app.store.addSource('lost', 'missing-source', { startSeq: 0, endSeq: 5 }); app.store.markIndex('missing-source', 5, 'ready')
    app.store.seed([{ id: 'archived', title: 'Archived', summary: '', entities: [], keywords: [], lastState: '' }])
    const archived = await source(app, app.root)
    app.store.addSource('archived', archived.id, { startSeq: 0, endSeq: 5 }); app.store.markIndex(archived.id, 5, 'ready')
    await app.ctx.plugin(Storage); await app.ctx.plugin(JsonStorage, { root: join(app.root, 'workspace-store') })
    await app.ctx.plugin(StorageDomain, { backend: 'json' }); await app.ctx.plugin(WorkspaceRegistry)
    await app.ctx.workspaceRegistry.archiveSession(archived.id)
    const reads: string[] = []
    const read = app.ctx.sessionQuery.readSession.bind(app.ctx.sessionQuery)
    app.ctx.sessionQuery.readSession = async (...args) => { reads.push(args[0]); return read(...args) }
    await app.catalog.refresh()
    assert.equal(app.catalog.snapshot().status.consent, 'ask')
    assert.equal(app.catalog.snapshot().status.waiting, 2)
    assert.equal(app.catalog.incomplete, false)
    assert.equal(app.model.requests.filter(r => r.system === CATALOG_PROMPT).length, 0)
    assert.deepEqual(reads, [])
    for (const id of [a.id, b.id]) assert.equal(app.store.indexState(id), undefined)
    for (const id of [app.gateway.id, owned.workingSessionId]) assert.equal(app.store.indexState(id)?.status, 'skipped')
    assert.equal(app.store.hiddenReasons().get('lost'), 'orphaned')
    assert.equal(app.store.hiddenReasons().get('archived'), 'archived')
  } finally { await app.close() }
})

test('granting consent indexes history; declining stops later reads without deleting existing topics', async () => {
  const app = await setup()
  try {
    const history = await source(app, app.root)
    await app.catalog.refresh()
    app.store.setCatalogConsent('granted'); app.catalog.requestRefresh(); await app.catalog.refresh()
    assert.equal(app.catalog.snapshot().status.consent, 'granted')
    assert.equal(app.store.indexState(history.id)?.status, 'ready')
    assert.equal(app.model.requests.filter(r => r.system === CATALOG_PROMPT).length, 1)
    const count = app.store.contexts().length
    app.store.setCatalogConsent('declined')
    await ask(history, 'Later private material')
    await app.catalog.refresh()
    assert.equal(app.catalog.snapshot().status.consent, 'declined')
    assert.equal(app.catalog.snapshot().status.waiting, 1)
    assert.equal(app.catalog.incomplete, false)
    assert.equal(app.store.contexts().length, count)
    assert.equal(app.model.requests.filter(r => r.system === CATALOG_PROMPT).length, 1)
  } finally { await app.close() }
})

test('session and Windows folder exclusions prevent reads and model transmission without matching sibling folders', async () => {
  const app = await setup()
  try {
    const byId = await source(app, app.root, 'SECRET_BY_ID')
    const byFolder = await source(app, 'C:\\Private\\nested', 'SECRET_BY_FOLDER')
    const sibling = await source(app, 'C:\\Private-other', 'Allowed sibling')
    app.store.setCatalogConsent('granted')
    app.store.setCatalogExcluded('session', byId.id, true)
    app.store.setCatalogExcluded('folder', 'c:/private/', true)
    const reads: string[] = []
    const read = app.ctx.sessionQuery.readSession.bind(app.ctx.sessionQuery)
    app.ctx.sessionQuery.readSession = async (...args) => { reads.push(args[0]); return read(...args) }
    await app.catalog.refresh()
    assert.equal(app.catalog.snapshot().status.excluded, 2)
    assert.equal(app.catalog.snapshot().status.pending, 0)
    assert.equal(app.catalog.incomplete, false)
    assert.ok(!reads.includes(byId.id) && !reads.includes(byFolder.id))
    const requests = app.model.requests.filter(r => r.system === CATALOG_PROMPT)
    assert.deepEqual(requests.map(r => r.sessionId), [sibling.id])
    assert.doesNotMatch(JSON.stringify(requests), /SECRET_BY_ID|SECRET_BY_FOLDER/)
    assert.equal(app.store.indexState(byId.id), undefined)
    assert.equal(app.store.indexState(byFolder.id), undefined)
  } finally { await app.close() }
})

test('excluding every known source hides a topic from routing and is reversible without deleting its history', async () => {
  const app = await setup()
  try {
    const origin = await source(app, app.root)
    app.store.setCatalogConsent('granted'); await app.catalog.refresh()
    const topic = app.catalog.snapshot().contexts.find(c => c.title === 'Imported topic')!
    const second = await source(app, app.root)
    app.store.addSource(topic.id, second.id, { startSeq: 0, endSeq: 5 }); app.store.markIndex(second.id, 9999, 'ready')
    app.store.setCatalogExcluded('session', origin.id, true)
    await app.catalog.refresh()
    assert.equal(app.store.hiddenReasons().get(topic.id), undefined)
    app.store.setCatalogExcluded('session', second.id, true)
    await app.catalog.refresh()
    assert.equal(app.catalog.snapshot().contexts.find(c => c.id === topic.id)?.hidden, 'excluded')
    assert.ok(app.store.unreachable().has(topic.id))
    assert.ok(!(await app.catalog.candidates('Imported topic')).some(c => c.id === topic.id))
    assert.equal(app.store.sources(topic.id).length, 2)
    app.store.setCatalogExcluded('session', origin.id, false)
    await app.catalog.refresh()
    assert.equal(app.store.hiddenReasons().get(topic.id), undefined)
    assert.ok(!app.store.unreachable().has(topic.id))
    assert.ok((await app.catalog.candidates('Imported topic')).some(c => c.id === topic.id))
  } finally { await app.close() }
})

for (const consent of [undefined, 'declined'] as const) test(`startup migrates ready history but preserves ${consent ?? 'absent'} consent correctly`, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-consent-upgrade-'))
  const path = join(root, 'contexts.db')
  const store = new ContextStore(path)
  store.markIndex('old', 5, 'ready')
  if (consent) store.setCatalogConsent(consent)
  store.close()
  const app = await harness(root, fixture(), { historyCatalog: true })
  try {
    assert.equal(app.ctx.theone.store.catalogConsent(), consent ?? 'granted')
    assert.equal(app.ctx.theone.catalog!.snapshot().status.consent, consent ?? 'granted')
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('consent and exclusions persist across reopening the database and can be removed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-consent-store-'))
  const path = join(root, 'contexts.db')
  let store = new ContextStore(path)
  try {
    assert.equal(store.catalogConsent(), undefined); assert.equal(store.hasIndexedHistory(), false)
    store.markIndex('failed', -1, 'failed'); assert.equal(store.hasIndexedHistory(), false)
    store.setCatalogConsent('declined'); store.setCatalogConsent('granted')
    store.setCatalogExcluded('session', 'private', true); store.setCatalogExcluded('folder', root, true)
    store.close(); store = new ContextStore(path)
    assert.equal(store.catalogConsent(), 'granted')
    assert.deepEqual(store.catalogExclusions(), { sessions: new Set(['private']), folders: [root] })
    store.setCatalogExcluded('session', 'private', false); store.setCatalogExcluded('folder', root, false)
    assert.deepEqual(store.catalogExclusions(), { sessions: new Set(), folders: [] })
  } finally { store.close(); await rm(root, { recursive: true, force: true }) }
})

test('catalog consent and session HTTP routes validate bodies and selections, refresh status, and omit ineligible sessions', async () => {
  const app = await setup(true)
  try {
    await app.ctx.plugin(Storage); await app.ctx.plugin(JsonStorage, { root: join(app.root, 'workspace-store') })
    await app.ctx.plugin(StorageDomain, { backend: 'json' }); await app.ctx.plugin(WorkspaceRegistry)
    const project = join(app.root, 'project'); await mkdir(project); await app.ctx.workspaceRegistry.create(project)
    const included = await source(app, join(project, 'child'))
    const child = await app.ctx.agents.create({ sessionId: SessionId(randomUUID()), meta: { cwd: project, origin: 'subagent' }, agentOptions: { provider: 'fixture', model: 'fixture' } })
    const archived = await source(app, app.root); await app.ctx.workspaceRegistry.archiveSession(archived.id)
    app.store.rememberGateway('test-gateway', app.gateway.id)
    const own = app.store.contexts()[0].workingSessionId
    await app.ctx.agents.create({ sessionId: SessionId(own), meta: { cwd: project }, agentOptions: { provider: 'fixture', model: 'fixture' } })
    const connection = new HostConnectionService(app.ctx, [], undefined as never), handler = peered(connection)
    await new Promise<void>(resolve => setImmediate(resolve))
    const call = (path: string, body?: unknown) => handler.fetch(new Request('http://dsh.internal/api/theone/catalog' + path,
      body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))
    await app.catalog.refresh()
    assert.equal((await (await call('')).json()).status.consent, 'ask')
    const choices = await (await call('/sessions')).json()
    assert.deepEqual(choices.sessions.map((s: { id: string }) => s.id), [included.id])
    assert.equal(choices.sessions[0].folder, project); assert.equal(typeof choices.sessions[0].createdAt, 'number')
    assert.equal(choices.folders[0].path, project)
    const readTitle = app.ctx.sessionQuery.readTitle.bind(app.ctx.sessionQuery)
    app.ctx.sessionQuery.readTitle = async () => { throw new Error('title unavailable') }
    assert.equal((await (await call('/sessions')).json()).sessions[0].title, '')
    app.ctx.sessionQuery.readTitle = readTitle
    for (const path of ['/consent', '/sessions']) {
      const bad = await handler.fetch(new Request('http://dsh.internal/api/theone/catalog' + path, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' }))
      assert.equal(bad.status, 400); assert.deepEqual(await bad.json(), { error: 'INVALID_INPUT' })
    }
    for (const body of [null, {}, { consent: 'true' }, { consent: 1 }]) assert.equal((await call('/consent', body)).status, 400)
    for (const body of [null, {}, { kind: 'bad', value: included.id, excluded: true }, { kind: 'session', value: included.id, excluded: 'yes' },
      { kind: 'session', value: child.agent.id, excluded: true }, { kind: 'session', value: archived.id, excluded: true }, { kind: 'session', value: own, excluded: true },
      { kind: 'session', value: 'unknown', excluded: true }, { kind: 'folder', value: app.root, excluded: true }])
      assert.equal((await call('/sessions', body)).status, 400)
    for (const kind of ['session', 'folder']) {
      const value = kind === 'session' ? included.id : project
      assert.equal((await call('/sessions', { kind, value, excluded: true })).status, 200)
    }
    assert.equal((await (await call('/sessions')).json()).sessions[0].excluded, true)
    assert.equal((await (await call('/consent', { consent: false })).json()).consent, 'declined')
    assert.equal((await (await call('/consent', { consent: true })).json()).consent, 'granted')
    await app.catalog.refresh()
    assert.equal(app.catalog.snapshot().status.excluded, 1)
    assert.equal(app.model.requests.filter(r => r.system === CATALOG_PROMPT).length, 0)
    for (const kind of ['session', 'folder']) await call('/sessions', { kind, value: kind === 'session' ? included.id : project, excluded: false })
    await app.catalog.refresh()
    assert.equal(app.store.indexState(included.id)?.status, 'ready')
  } finally { await app.close() }
})

test('disabled catalog does not offer consent and rejects consent changes with CATALOG_DISABLED', async () => {
  const app = await setup()
  try {
    const handler = peered(new HostConnectionService(app.ctx, [], undefined as never))
    await new Promise<void>(resolve => setImmediate(resolve))
    const snapshot = await (await handler.fetch(new Request('http://dsh.internal/api/theone/catalog'))).json()
    assert.equal(snapshot.status.consent, undefined)
    const response = await handler.fetch(new Request('http://dsh.internal/api/theone/catalog/consent', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ consent: true }) }))
    assert.equal(response.status, 409); assert.deepEqual(await response.json(), { error: 'CATALOG_DISABLED' })
    assert.equal(app.store.catalogConsent(), undefined)
  } finally { await app.close() }
})
for (const change of ['decline', 'exclude'] as const) test(`a ${change} during title lookup prevents the next model request`, async () => {
  const app = await setup()
  try {
    const history = await source(app, app.root)
    app.store.setCatalogConsent('granted')
    const readTitle = app.ctx.sessionQuery.readTitle.bind(app.ctx.sessionQuery)
    app.ctx.sessionQuery.readTitle = async (...args) => {
      const title = await readTitle(...args)
      if (args[0] === history.id) {
        if (change === 'decline') app.store.setCatalogConsent('declined')
        else app.store.setCatalogExcluded('session', history.id, true)
        app.catalog.requestRefresh()
      }
      return title
    }
    await app.catalog.refresh()
    assert.equal(app.model.requests.filter(r => r.system === CATALOG_PROMPT).length, 0)
    assert.equal(app.store.indexState(history.id), undefined)
    assert.equal(app.catalog.incomplete, false)
  } finally { await app.close() }
})

for (const change of ['decline', 'exclude'] as const) test(`a ${change} during a model response prevents importing it and stops later batches`, async () => {
  const app = await setup()
  try {
    const history = await source(app, app.root)
    for (let i = 0; i < 8; i++) await ask(history, 'More history ' + i)
    app.store.setCatalogConsent('granted')
    const base = app.model.behavior!
    app.model.behavior = async function* (options) {
      if (options.system === CATALOG_PROMPT) {
        if (change === 'decline') app.store.setCatalogConsent('declined')
        else app.store.setCatalogExcluded('folder', app.root, true)
        app.catalog.requestRefresh()
      }
      yield* base(options)
    }
    await app.catalog.refresh()
    assert.equal(app.model.requests.filter(r => r.system === CATALOG_PROMPT).length, 1)
    assert.equal(app.store.indexState(history.id), undefined)
    assert.equal(app.store.contexts().some(c => c.title === 'Imported topic'), false)
    assert.equal(app.catalog.incomplete, false)
  } finally { await app.close() }
})

test('folder boundaries normalize Windows drive and UNC paths without folding POSIX case', () => {
  for (const [cwd, folder, expected] of [
    ['C:\\Private\\nested', 'c:/private/', true],
    ['C:/private-other', 'c:/private', false],
    ['C:/private/../public', 'C:/private', false],
    ['C:/private', 'c:/', true],
    ['\\\\Server\\Share\\Private\\child', '//server/share/private/', true],
    ['/home/private/child', '/home/private', true],
    ['/home/PRIVATE', '/home/private', false],
    ['/home/private-other', '/home/private', false],
    ['/home', '/', true],
  ] as const) assert.equal(withinCatalogFolder(cwd, folder), expected, `${cwd} inside ${folder}`)
})

for (const locale of ['zh-CN', 'en-US']) for (const mode of ['ask', 'granted', 'disabled'] as const)
  test(`the ${locale} welcome reflects ${mode} history consent without model calls`, async () => {
    const app = await setup(mode !== 'disabled')
    try {
      if (mode === 'granted') app.store.setCatalogConsent('granted')
      app.ctx.theone.welcomeGateway(app.gateway.id, locale)
      await app.gateway.whenIdle()
      const text = app.gateway.session.snapshotEvents().flatMap(event => event.type === 'assistant/message'
        ? event.data.message.content.flatMap(block => block.type === 'text' ? [block.text] : []) : []).join('')
      if (mode === 'ask') assert.match(text, locale === 'zh-CN' ? /一条都还没看/ : /haven't looked/)
      if (mode === 'granted') assert.match(text, locale === 'zh-CN' ? /原来的会话都还在/ : /original conversations are all still there/)
      if (mode === 'disabled') assert.doesNotMatch(text, /话题工作区|Topic workspaces/)
      assert.equal(app.model.requests.length, 0)
    } finally { await app.close() }
  })

for (const change of ['decline', 'exclude'] as const) test(`changing consent or exclusions during model preparation (${change}) prevents transmission`, async () => {
  const app = await setup()
  try {
    const history = await source(app, app.root, 'PRIVATE_DURING_PREPARATION')
    app.store.setCatalogConsent('granted')
    const prepare = app.ctx.llm.prepareCall.bind(app.ctx.llm)
    app.ctx.llm.prepareCall = async (...args) => {
      const call = await prepare(...args)
      if (change === 'decline') app.store.setCatalogConsent('declined')
      else app.store.setCatalogExcluded('session', history.id, true)
      app.catalog.requestRefresh()
      return call
    }
    await app.catalog.refresh()
    assert.equal(app.model.requests.filter(r => r.system === CATALOG_PROMPT).length, 0)
    assert.equal(app.store.indexState(history.id), undefined)
    assert.equal(app.catalog.snapshot().status.failed, 0)
    assert.equal(app.catalog.incomplete, false)
  } finally { await app.close() }
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, get, type IncomingMessage, type ServerResponse } from 'node:http'
import { Service, type Context } from '@deepseek-ai/cordis'
import * as Connection from '@deepseek-ai/dsh-client-connection'
import { harness } from './harness.ts'
import type { BubbleReadResponse } from '../src/bubble-types.ts'

class FixtureService extends Service {
  constructor(ctx: Context, name: string, value: Record<string, unknown>) { super(ctx, name); Object.assign(this, value) }
}

test('real HTTP through the installed DSH bridge holds for 25 seconds and releases a disconnected client', { timeout: 40000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'theone-bubble-http-')), app = await harness(root)
  type Route = { path: string; kind: string; handler(req: IncomingMessage, res: ServerResponse): Promise<void> | void }
  const routes = new Map<string, Route>()
  let connection: Connection.HostConnectionService
  const server = createServer((req, res) => {
    const path = new URL(req.url!, 'http://localhost').pathname
    if (path === '/') { connection.authorizeIndex(req, res); return }
    const route = [...routes.values()].find(route => route.kind === 'prefix' ? path.startsWith(route.path) : path === route.path)
    if (!route) { res.writeHead(404); res.end(); return }
    Promise.resolve(route.handler(req, res)).catch(() => { if (!res.destroyed) { res.writeHead(500); res.end() } })
  })
  try {
    new FixtureService(app.ctx, 'credentials', { modifyRecord: async (_key: unknown, update: (current: undefined) => Promise<unknown>) => update(undefined) })
    new FixtureService(app.ctx, 'webServer', { host: '127.0.0.1', protocol: 'http:', register: (route: Route) => { routes.set(route.path, route); return () => { routes.delete(route.path) } } })
    await app.ctx.plugin(Connection)
    connection = app.ctx.connection as Connection.HostConnectionService
    await new Promise<void>(resolve => setImmediate(resolve))
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address(); assert.ok(address && typeof address !== 'string')
    const base = 'http://127.0.0.1:' + address.port
    // Only an isolated fixture's generated launch token is used; no user's profile or credentials.
    const login = await fetch(connection.authenticatedUrl(base + '/'), { redirect: 'manual' })
    const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
    assert.ok(cookie)
    app.ctx.theone.store.rememberGateway('test-gateway', app.gateway.id)
    const initial = await (await fetch(base + '/api/theone/bubbles', { headers: { cookie } })).json() as BubbleReadResponse
    assert.equal(initial.kind, 'update'); if (initial.kind !== 'update') return
    const cursor = initial.snapshot.cursor, url = base + '/api/theone/bubbles?' + new URLSearchParams({ gatewayId: app.gateway.id, epoch: cursor.epoch, since: String(cursor.version), after: String(cursor.seq), waitMs: '25000' })
    const started = performance.now(), pending = fetch(url, { headers: { cookie } })
    assert.equal((await fetch(base + '/api/theone/owned', { headers: { cookie } })).status, 200)
    const timeout = await pending
    assert.equal(timeout.status, 200); assert.equal((await timeout.json() as BubbleReadResponse).kind, 'unchanged')
    const elapsed = performance.now() - started
    assert.ok(elapsed >= 24900 && elapsed < 35000, String(elapsed))
    t.diagnostic('HTTP long poll elapsed ' + Math.round(elapsed) + ' ms')
    const aggregator = app.ctx.theone.bubbles, registered = Promise.withResolvers<void>(), finished = Promise.withResolvers<void>()
    const original = aggregator.poll.bind(aggregator)
    aggregator.poll = (q, signal) => {
      const result = original(q, signal)
      registered.resolve()
      return result.finally(() => finished.resolve())
    }
    const request = get(url, { headers: { cookie } })
    request.on('error', () => {})
    await registered.promise
    assert.equal(aggregator.pendingRequests, 1)
    request.destroy()
    await finished.promise
    assert.equal(aggregator.pendingRequests, 0)
    t.diagnostic('Real socket disconnect cancelled the request through DSH Request.signal')
  } finally {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    await app.close(); await rm(root, { recursive: true, force: true })
  }
})

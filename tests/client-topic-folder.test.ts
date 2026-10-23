import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'esbuild'
import { runInNewContext } from 'node:vm'

// Run the real client entry; only the browser/host boundaries are faked.
const bundle = await build({ entryPoints: ['src/client.ts'], bundle: true, write: false, platform: 'browser', format: 'cjs', external: ['react'] })
const flush = () => new Promise<void>(resolve => setImmediate(resolve))

async function fixture() {
  let topicFolder = '/topics/first', nextTimer = 0
  const timers = new Map<number, () => void>()
  const disposers: (() => void)[] = []
  const listeners = new Set<() => void>()
  const noop = () => {}
  const sessions = { ids: ['gateway'], byId: { gateway: { id: 'gateway', cwd: '/theone/gateway' } } }
  const exports = {}
  const scope = {
    module: { exports }, exports, require: () => ({}), AbortController, AbortSignal, console,
    location: { pathname: '/' }, CSS: { escape: (value: string) => value },
    window: { localStorage: { getItem: () => 'gateway' }, addEventListener: noop, removeEventListener: noop, location: { reload: noop } },
    document: { head: { append: noop }, createElement: () => ({ dataset: {}, remove: noop }) },
    setTimeout: (callback: () => void) => { timers.set(++nextTimer, callback); return nextTimer },
    setInterval: () => ++nextTimer,
    clearTimeout: (id: number) => timers.delete(id), clearInterval: (id: number) => timers.delete(id),
    fetch: async (url: string) => url === '/api/theone/gateway'
      ? { ok: true, json: async () => ({ cwd: '/theone/gateway', current: 'gateway', topicFolder }) }
      : { ok: false },
  }
  runInNewContext(bundle.outputFiles[0].text, scope)
  const list = {
    getSnapshot: () => sessions,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
  const ctx = {
    effect: (effect: () => (() => void) | void) => { const dispose = effect(); if (dispose) disposers.push(dispose) },
    locale: { register: () => noop, bind: () => noop, subscribe: () => noop, getSnapshot: () => ({ active: 'en' }) },
    sessions: { list },
    workspaces: { list: { getSnapshot: () => ({ phase: 'loading' }), subscribe: () => noop } },
    slots: { inject: noop }, inject: noop,
  }
  ;(scope.module.exports as { apply(ctx: unknown): void }).apply(ctx)
  const settle = async () => {
    await flush()
    for (const [id, callback] of [...timers]) { timers.delete(id); callback() }
    await flush(); await flush()
  }
  await settle()
  return {
    list, settle,
    set topicFolder(value: string) { topicFolder = value },
    /** DSH says the list changed, as it does after a routed message. */
    changed: () => { for (const listener of [...listeners]) listener() },
    dispose: () => { for (const dispose of disposers.reverse()) dispose() },
  }
}

test('main chat shows the folder of the topic in use', async () => {
  const f = await fixture()
  assert.equal(f.list.getSnapshot().byId.gateway.cwd, '/topics/first')
  f.dispose()
  assert.equal(f.list.getSnapshot().byId.gateway.cwd, '/theone/gateway')
})

test('a new topic in use tells the list\'s readers, though no session changed', async () => {
  const f = await fixture()
  let renders = 0
  const unsubscribe = f.list.subscribe(() => { renders++ })
  f.topicFolder = '/topics/second'
  f.changed()
  renders = 0
  await f.settle()
  assert.equal(renders, 1, 'without a nudge the panel keeps the first topic\'s folder until some other change')
  assert.equal(f.list.getSnapshot().byId.gateway.cwd, '/topics/second')
  f.changed(); renders = 0
  await f.settle()
  assert.equal(renders, 0, 'the same folder again is not news')
  unsubscribe()
  f.dispose()
})

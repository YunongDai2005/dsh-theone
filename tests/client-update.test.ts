import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'esbuild'
import { runInNewContext } from 'node:vm'

// Run the real client entry and its effects. Only the browser/host boundaries are
// faked, so this also covers wiring the poller to the plugin's disposal lifetime.
const bundle = await build({ entryPoints: ['src/client.ts'], bundle: true, write: false, platform: 'browser', format: 'cjs', external: ['react'] })
const flush = () => new Promise<void>(resolve => setImmediate(resolve))

async function fixture() {
  let current = '0.3.34', reloads = 0, requests = 0, nextTimer = 0
  let pollSignal: AbortSignal | undefined
  let respond: (() => Promise<unknown>) | undefined
  const timers = new Map<number, { callback: () => void; delay: number; repeat: boolean }>()
  const disposers: (() => void)[] = []
  const noop = () => {}
  const subscribe = () => noop
  const exports = {}
  const scope = {
    module: { exports }, exports, require: () => ({}), AbortController, AbortSignal, console,
    location: { pathname: '/' },
    window: { localStorage: { getItem: () => null }, addEventListener: noop, removeEventListener: noop,
      location: { reload: () => { reloads++ } } },
    document: { head: { append: noop }, createElement: () => ({ dataset: {}, remove: noop }) },
    setTimeout: (callback: () => void, delay: number) => { timers.set(++nextTimer, { callback, delay, repeat: false }); return nextTimer },
    setInterval: (callback: () => void, delay: number) => { timers.set(++nextTimer, { callback, delay, repeat: true }); return nextTimer },
    clearTimeout: (id: number) => timers.delete(id), clearInterval: (id: number) => timers.delete(id),
    fetch: async (url: string, options?: RequestInit) => {
      if (url.startsWith('/api/theone/update')) {
        requests++
        pollSignal = options?.signal ?? undefined
        return { ok: true, json: respond ?? (async () => ({ current, state: current === '0.3.34' ? 'reloading' : undefined })) }
      }
      return { ok: false }
    },
  }
  runInNewContext(bundle.outputFiles[0].text, scope)
  const ctx = {
    effect: (effect: () => (() => void) | void) => { const dispose = effect(); if (dispose) disposers.push(dispose) },
    locale: { register: subscribe, bind: () => noop, subscribe, getSnapshot: () => ({ active: 'en' }) },
    sessions: { list: { getSnapshot: () => ({ ids: [], byId: {} }), subscribe } },
    workspaces: { list: { getSnapshot: () => ({ phase: 'loading' }), subscribe } },
    slots: { inject: noop }, inject: noop,
  }
  ;(scope.module.exports as { apply(ctx: unknown): void }).apply(ctx)
  await flush()
  return {
    get reloads() { return reloads }, get requests() { return requests },
    get pollSignal() { return pollSignal },
    get polls() { return [...timers.values()].filter(timer => timer.delay === 1500).length },
    updated: () => { current = '0.3.35' },
    respond: (fn: () => Promise<unknown>) => { respond = fn },
    dispose: () => { for (const dispose of disposers.reverse()) dispose() },
    async tick(delay: number) {
      for (const [id, timer] of [...timers]) if (timer.delay === delay) {
        if (!timer.repeat) timers.delete(id)
        timer.callback()
      }
      await flush()
    },
  }
}

test('a successful backend update leaves interface replacement to DSH HMR', async () => {
  const f = await fixture()
  f.updated()
  await f.tick(1500)
  assert.equal(f.reloads, 0, 'a backend version change must not restart the desktop boot audit')
  assert.equal(f.polls, 0)
  f.dispose()
})

test('disposing the old client cancels its update poll instead of reloading the new client', async () => {
  const f = await fixture()
  f.dispose()
  f.updated()
  await f.tick(1500)
  assert.equal(f.requests, 1, 'an unloaded plugin must not keep polling')
  assert.equal(f.reloads, 0)
  assert.equal(f.polls, 0)
})

test('repeated reloading statuses share one update poll', async () => {
  const f = await fixture()
  await f.tick(6 * 3600000)
  assert.equal(f.polls, 1)
  f.dispose()
})

test('disposal aborts an in-flight poll and ignores its late response', async () => {
  const f = await fixture()
  let complete!: (value: unknown) => void
  f.respond(() => new Promise(resolve => { complete = resolve }))
  await f.tick(1500)
  assert.equal(f.pollSignal?.aborted, false)
  f.dispose()
  assert.equal(f.pollSignal?.aborted, true)
  complete({ current: '0.3.35' })
  await flush()
  assert.equal(f.reloads, 0)
  assert.equal(f.polls, 0)
})

test('temporary update endpoint failures are retried without navigating', async () => {
  const f = await fixture()
  f.respond(async () => { throw new Error('backend is restarting') })
  await f.tick(1500)
  assert.equal(f.polls, 1)
  f.respond(async () => ({ current: '0.3.35' }))
  await f.tick(1500)
  assert.equal(f.reloads, 0)
  assert.equal(f.polls, 0)
  f.dispose()
})

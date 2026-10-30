import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'esbuild'
import { runInNewContext } from 'node:vm'

// Run the actual setup client and finish action. Only browser and HTTP boundaries
// are faked; catalog-consent.test.ts separately verifies these backend responses.
const bundle = await build({ entryPoints: ['src/client-setup.ts'], bundle: true, write: false, platform: 'browser', format: 'cjs' })
const flush = () => new Promise<void>(resolve => setImmediate(resolve))

async function fixture(consent?: 'ask' | 'declined' | 'granted') {
  const requests: { url: string; method: string; body?: Record<string, unknown> }[] = []
  let closed = 0
  const noop = () => {}
  const listeners = new Map<string, (event: unknown) => void>()
  const generic = { style: {}, focus: noop, hidden: false, textContent: '' }
  const overlay = {
    innerHTML: '', className: '', setAttribute: noop, remove: noop,
    querySelector: () => generic,
    querySelectorAll: (selector: string) => selector === '.theone-setup-page'
      ? Array.from({ length: 6 }, () => ({ inert: false, querySelector: () => generic })) : [],
    addEventListener: (name: string, listener: (event: unknown) => void) => listeners.set(name, listener),
  }
  const values = { hideTopicSessions: false, routeNotice: 'switch', historyCatalog: consent !== undefined,
    workerProvider: 'nebius', workerModel: 'nvidia/nemotron-3-super-120b-a12b' }
  const exports = {}
  const scope = {
    module: { exports }, exports, AbortController, Event,
    document: { createElement: () => overlay, addEventListener: noop, removeEventListener: noop, body: { append: noop } },
    window: { dispatchEvent: noop }, matchMedia: () => ({ matches: true }), cancelAnimationFrame: noop,
    fetch: async (url: string, options?: RequestInit) => {
      const method = options?.method ?? 'GET'
      requests.push({ url, method, ...(options?.body ? { body: JSON.parse(String(options.body)) } : {}) })
      if (url === '/api/theone/catalog') return { ok: true, json: async () => ({ status: consent ? { consent } : { running: false } }) }
      if (url === '/api/theone/catalog/consent') return { ok: consent !== undefined, status: consent === undefined ? 409 : 200 }
      if (url === '/api/theone/settings') return { ok: true, json: async () => ({ savedValues: values, revision: 3 }) }
      throw new Error('Unexpected request: ' + url)
    },
  }
  runInNewContext(bundle.outputFiles[0].text, scope)
  const controller = new AbortController()
  await (scope.module.exports as { openSetup(options: unknown): Promise<void> }).openSetup({ t: (key: string) => key,
    cellFrame: () => ({ membrane: '', x: 10, y: 10, r: 3 }), signal: controller.signal, onClose: () => { closed++ } })
  return {
    requests, values, get html() { return overlay.innerHTML }, get closed() { return closed },
    async finish() {
      const button = { dataset: { finish: '' }, disabled: false, removeAttribute: noop, setAttribute: noop }
      listeners.get('click')!({ target: { closest: () => button } })
      await flush(); await flush()
    },
    dispose: () => controller.abort(),
  }
}

test('a disabled catalog can finish setup without a forbidden consent request', async () => {
  const f = await fixture()
  try {
    assert.doesNotMatch(f.html, /setup\.sortTitle/)
    await f.finish()
    assert.equal(f.closed, 1)
    assert.equal(f.requests.some(r => r.url === '/api/theone/catalog/consent'), false)
    const settings = f.requests.find(r => r.url === '/api/theone/settings' && r.method === 'PUT')!
    assert.deepEqual(settings.body?.values, f.values, 'finishing appearance setup must retain the bounded Nebius configuration')
  } finally { f.dispose() }
})

for (const consent of ['ask', 'declined', 'granted'] as const)
  test(`setup preserves the enabled catalog's ${consent} consent behavior`, async () => {
    const f = await fixture(consent)
    try {
      assert.equal(f.html.includes('setup.sortTitle'), consent !== 'granted')
      await f.finish()
      assert.equal(f.closed, 1)
      assert.equal(f.requests.filter(r => r.url === '/api/theone/catalog/consent').length, consent === 'granted' ? 0 : 1)
    } finally { f.dispose() }
  })

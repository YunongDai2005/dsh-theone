import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ContextStore } from '../src/store.ts'
import { harness } from './harness.ts'

test('main chat picking TheOne leaves the user’s default model as it was', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-default-model-'))
  const app = await harness(root)
  try {
    // DSH saves every session's model choice as the default; stand in for its profile write.
    let saved = { provider: 'deepseek', model: 'deepseek-v4' }
    const service = app.ctx.agentDefaultModel as unknown as { currentSelection(): typeof saved; saveSelection(next: typeof saved): Promise<void> }
    service.currentSelection = () => ({ ...saved })
    service.saveSelection = async next => { saved = { provider: next.provider, model: next.model } }

    app.ctx.theone.holdDefaultModel()
    await service.saveSelection({ provider: 'theone', model: 'gateway' }) // what DSH does for main chat
    await app.ctx.theone.restoreDefaultModel()
    assert.deepEqual(saved, { provider: 'deepseek', model: 'deepseek-v4' })

    // A default the user set to TheOne themselves is not changed.
    saved = { provider: 'theone', model: 'gateway' }
    app.ctx.theone.holdDefaultModel()
    await app.ctx.theone.restoreDefaultModel()
    assert.deepEqual(saved, { provider: 'theone', model: 'gateway' })
    // Nothing held, nothing restored.
    await app.ctx.theone.restoreDefaultModel()
    assert.deepEqual(saved, { provider: 'theone', model: 'gateway' })
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('one-time repairs run once', () => {
  const store = new ContextStore(':memory:')
  try {
    assert.equal(store.markOnce('default-model-restored'), true)
    assert.equal(store.markOnce('default-model-restored'), false)
  } finally { store.close() }
})

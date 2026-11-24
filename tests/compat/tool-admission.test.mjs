import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { harness } from '../harness.ts'

test('topic tool cards are available from the first TheOne step and stay out of ordinary steps', async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-step-tools-'))
  const app = await harness(root)
  try {
    const { ctx, gateway } = app
    const admitted = async provider => {
      const step = await ctx.tools.resolve({ agent: gateway, modelSelection: { provider, model: 'fixture' }, signal: new AbortController().signal })
      try { return ctx.tools.executable('theone_update_state', gateway, step) } finally { step.dispose() }
    }
    assert.equal(await admitted('fixture'), undefined)
    const card = await admitted('theone')
    assert.ok(card, 'the first step must already have the progress tool output contract')
    await assert.rejects(() => card.execute({ state: 'unexpected' }, { agent: gateway, signal: new AbortController().signal }), /only displays results/)
    assert.equal(await admitted('fixture'), undefined)
    ctx.theone.store.rememberGateway('test-gateway', gateway.id)
    assert.ok(await admitted('fixture'), 'the pinned main chat routes even when its selector shows a backing model')
  } finally {
    await app.close()
    await rm(root, { recursive: true, force: true })
  }
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { harness, ask } from './harness.ts'

test('a message naming two topics is not asked about, in either language: the first does the work, the other comes along', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-language-'))
  const app = await harness(root)
  try {
    for (const text of ['Qwen or the thesis status?', 'Qwen 和论文的进度？']) {
      const result = await ask(app.gateway, text)
      assert.equal(result.output, '模拟回答：ctx_qwen_9070xt')
      const decision = app.ctx.theone.store.route(result.input.id)?.decision
      assert.equal(decision?.reason, 'unclear-settled')
      assert.deepEqual(decision?.alternateIds, ['ctx_thesis'])
      // Notices are hidden by default, but a route that hesitated says so, in the message's language.
      const notice = result.events.find(event => event.type === 'user/message' && event.data.source.kind === 'theone-route')
      assert.ok(notice?.type === 'user/message')
      assert.match(notice.data.content.map(block => block.type === 'text' ? block.text : '').join(''), /may be about "Video Attention Thesis"|也可能是「Video Attention Thesis」/)
    }
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

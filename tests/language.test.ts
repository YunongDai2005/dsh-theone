import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { harness, ask } from './harness.ts'

test('TheOne asks its own questions in the language the message was written in', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-language-'))
  const app = await harness(root)
  try {
    // Rules routing: a message naming two topics is asked about.
    assert.equal((await ask(app.gateway, 'Qwen or the thesis status?')).output, 'This touches several topics; which one first?')
    assert.equal((await ask(app.gateway, 'Qwen 和论文的进度？')).output, '这句话涉及多个话题，请指定先处理哪个。')
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

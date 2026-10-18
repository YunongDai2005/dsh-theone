import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ToolCallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { describeStep, resumeNote, topicTurn } from '../src/lifecycle.ts'
import { harness, ask, textResponse, FixtureModel } from './harness.ts'

const user = (id: string, text: string, seq: number) => ({ type: 'user/message', seq, data: { id, source: { kind: 'user' }, content: [{ type: 'text', text }] } })
const said = (text: string, seq: number) => ({ type: 'assistant/message', seq, data: { message: { content: [{ type: 'text', text }] } } })
const call = (name: string, args: unknown, seq: number) => ({ type: 'tool/call', seq, data: { name, arguments: JSON.stringify(args) } })
const end = (kind: string, seq: number) => ({ type: 'turn/end', seq, data: { reason: { kind } } })

test('a topic turn is read back from its session: finished or not, its reply, and the steps that may have changed something', () => {
  const events = [
    user('m1', '改一下 readme', 1), said('我先看看', 2), call('read', { file_path: 'README.md' }, 3), call('edit', { file_path: 'README.md', old_string: 'a', new_string: 'b' }, 4),
    call('bash', { command: 'npm   test' }, 5), said('改好了，测试通过', 6), end('completed', 7),
    user('m2', '再写一个 CHANGELOG', 8), call('write', { file_path: 'CHANGELOG.md', content: 'x' }, 9),
  ]
  assert.deepEqual(topicTurn(events, 'm1'), { found: true, request: '改一下 readme', completed: true, reply: '改好了，测试通过',
    changes: ['修改 README.md', '运行 npm test'], endSeq: 7 })
  // Cut off mid-way: no end, the change it had made is still listed.
  assert.deepEqual(topicTurn(events, 'm2'), { found: true, request: '再写一个 CHANGELOG', completed: false, reply: '', changes: ['写入 CHANGELOG.md'], endSeq: 9 })
  // Batched under another id: found by its words.
  assert.equal(topicTurn(events, 'other', '再写一个 CHANGELOG').found, true)
  assert.equal(topicTurn(events, 'missing').found, false)
  assert.equal(describeStep('send_message', '{"to":"x"}'), '调用 send_message')
  assert.match(resumeNote(topicTurn(events, 'm2')), /DSH 重启打断了你：「再写一个 CHANGELOG」[\s\S]*写入 CHANGELOG\.md[\s\S]*先检查现状/)
})

/** A topic with a live worker, and a message the topic received before a "restart". */
async function started(name: string, model = new FixtureModel()) {
  const root = await mkdtemp(join(tmpdir(), `theone-lifecycle-${name}-`))
  model.behavior ??= async function* () { yield* textResponse('好的') }
  const app = await harness(root, model)
  await ask(app.gateway, 'Qwen 那个')
  const store = app.ctx.theone.store
  const context = store.contexts().find(item => item.id === 'ctx_qwen_9070xt')!
  const worker = app.ctx.agents.get(SessionId(context.workingSessionId))!
  /** What a background start leaves behind when DSH stops before main chat shows it. */
  const restart = (messageId: string) => {
    store.plan(messageId, app.gateway.id, 'test-gateway', { action: 'KEEP', contextId: context.id, reason: 'test' }, false)
    store.claim(messageId)
    store.startTopicRun(messageId, context.id, context.workingSessionId)
    store.interruptTopicRuns()
  }
  const lastReply = () => {
    const reply = app.gateway.session.snapshotEvents().findLast(event => event.type === 'assistant/message')
    return reply?.type === 'assistant/message' ? reply.data.message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('') : ''
  }
  return { app, store, context, worker, restart, lastReply, close: async () => { await app.close(); await rm(root, { recursive: true, force: true }) } }
}

test('work a topic finished before a restart is shown as it was given, not redone and not called interrupted', { timeout: 30000 }, async () => {
  const model = new FixtureModel()
  model.behavior = async function* () { yield* textResponse('Qwen 已经配好了：显存 16G 够用') }
  const t = await started('finished', model)
  try {
    const message = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Qwen 配置检查一下' }] })
    // The topic answered in the background; then DSH stopped before main chat got to it.
    t.worker.followup(message)
    await t.worker.whenIdle()
    t.restart(message.id)
    const calls = model.requests.length
    t.app.gateway.followup(message)
    await t.app.gateway.whenIdle()
    assert.equal(model.requests.length, calls, 'nothing is redone')
    assert.equal(t.lastReply(), `DSH 重启前「${t.context.title}」已经做完了这条：\n\nQwen 已经配好了：显存 16G 够用`)
    assert.equal(t.store.topicRun(message.id)?.outcome, 'completed')
    assert.equal(t.store.route(message.id)?.status, 'completed')
  } finally { await t.close() }
})

test('work cut off mid-way lists what it had done; "continue" tells the topic once to check before carrying on', { timeout: 30000 }, async () => {
  const model = new FixtureModel()
  let step = 0
  const t = await started('cut', model)
  try {
    let entered!: () => void
    const inTool = new Promise<void>(resolve => { entered = resolve })
    t.app.ctx.tools.register(defineTool({ name: 'edit', description: 'Edit a file', parameters: { file_path: { type: 'string', required: true } },
      output: { schema: { type: 'string' }, render: (_args, value: string) => [{ type: 'text', text: value }] },
      execute: async (_args, exec) => { entered(); await new Promise((_resolve, reject) => exec.signal.addEventListener('abort', () => reject(exec.signal.reason))); return 'never' } }))
    model.behavior = async function* () {
      if (step++ === 0) {
        const id = ToolCallId('edit-1')
        yield { type: 'block-start', index: 0, blockType: 'tool-call' }
        yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'edit', arguments: '{"file_path":"config/qwen.yaml"}' } }
        yield { type: 'finish', reason: { kind: 'tool-calls' } }
      } else yield* textResponse('接着做完了')
    }
    const message = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '把 Qwen 的配置改成 16G' }] })
    t.worker.followup(message)
    await inTool
    // DSH stops while the topic is in the middle of editing.
    t.worker.cancel({ kind: 'user' })
    await t.worker.whenIdle()
    t.restart(message.id)
    t.app.gateway.followup(message)
    await t.app.gateway.whenIdle()
    const notice = t.lastReply()
    assert.match(notice, /重启打断了它。那时它已经：\n- 修改 config\/qwen\.yaml\n\n为了不重复这些改动，没有自动重做。说「继续」就接着做/)
    assert.equal(t.store.topicRun(message.id)?.outcome, 'interrupted')
    // "Continue" goes to that topic, which is told what it had done.
    await ask(t.app.gateway, '继续')
    const briefing = (request: (typeof model.requests)[number]) => request.messages.map(item => 'content' in item && Array.isArray(item.content)
      ? item.content.map(block => block.type === 'text' ? block.text : '').join('') : '').join('\n')
    const resumed = briefing(model.requests.at(-1)!)
    assert.match(resumed, /上次的这条消息做到一半时，DSH 重启打断了你：「把 Qwen 的配置改成 16G」/)
    assert.match(resumed, /修改 config\/qwen\.yaml/)
    // Only once.
    await ask(t.app.gateway, 'Qwen 还有别的要改吗')
    const later = model.requests.at(-1)!
    const latestBriefing = later.messages.filter(item => 'source' in item && item.source?.kind === 'theone-context').at(-1)
    const text = latestBriefing && 'content' in latestBriefing && Array.isArray(latestBriefing.content) ? latestBriefing.content.map(block => block.type === 'text' ? block.text : '').join('') : ''
    assert.equal(text.includes('重启打断了你'), false)
  } finally { await t.close() }
})

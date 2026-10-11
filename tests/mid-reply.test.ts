import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { harness, textResponse, FixtureModel } from './harness.ts'
import { ROUTING_PROMPT } from '../src/llm-router.ts'

const say = (text: string) => createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })
const words = (options: GenerateOptions) => options.messages.filter(message => message.role === 'user')
  .map(message => message.content.filter(block => block.type === 'text').map(block => block.text).join('')).join('\n')
const topicOf = (options: GenerateOptions) => {
  const recall = options.messages.find(message => message.role === 'user' && 'source' in message && message.source?.kind === 'theone-context')
  return recall && 'source' in recall && recall.source?.kind === 'theone-context' ? recall.source.contextId : undefined
}
const replies = (agent: Agent) => agent.session.snapshotEvents().flatMap(event => event.type === 'assistant/message'
  ? [event.data.message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('')] : []).filter(Boolean)
const asked = (agent: Agent) => agent.session.snapshotEvents().flatMap(event => event.type === 'user/message' && event.data.source.kind === 'user'
  ? [event.data.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('')] : [])

/**
 * A router that reads meaning from a fixed table (the real classifier's job), and topics that answer
 * by name. The Qwen topic holds its first reply until released, so messages arrive while it runs.
 */
function setup() {
  const model = new FixtureModel()
  const release = Promise.withResolvers<void>(), entered = Promise.withResolvers<void>()
  const log: string[] = []
  const routed: { text: string; running?: { topicId: string; request: string; progress: string } }[] = []
  let qwenCalls = 0
  model.behavior = async function* (options) {
    if (typeof options.system === 'string' && options.system.startsWith(ROUTING_PROMPT)) {
      const payload = JSON.parse(words(options)) as { text: string; running?: { topicId: string; request: string; progress: string } }
      routed.push({ text: payload.text, running: payload.running })
      const contextId = /论文|消融/.test(payload.text) ? 'ctx_thesis' : 'ctx_qwen_9070xt'
      yield* textResponse(JSON.stringify({ action: 'EXISTING', contextId, title: null, question: null, reason: '测试' }))
      return
    }
    const topic = topicOf(options)
    if (topic === 'ctx_qwen_9070xt') {
      log.push(`qwen:${++qwenCalls}`)
      if (qwenCalls === 1) {
        // Something already written, which the router sees as the running reply's progress.
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text: 'Qwen 正在测' }
        entered.resolve(); await release.promise
        yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Qwen 正在测' } }
        yield { type: 'finish', reason: { kind: 'stop' } }
        return
      }
      yield* textResponse(`Qwen 补充：${words(options).includes('14B') ? '14B' : '无'}`)
      return
    }
    log.push('thesis')
    yield* textResponse('论文回答')
  }
  return { model, release, entered, log, routed, qwenSaw: () => model.requests.filter(request => topicOf(request) === 'ctx_qwen_9070xt').map(words).join('\n') }
}

async function until(condition: () => boolean, ms = 5000) {
  const end = Date.now() + ms
  while (!condition()) {
    if (Date.now() > end) throw new Error('timed out')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

test('an interjection about another matter starts that topic at once and becomes its own turn, shown after the reply', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-mid-other-'))
  const fixture = setup()
  const app = await harness(root, fixture.model, { routerMode: 'llm', autoModel: true })
  try {
    app.gateway.followup(say('Qwen 那个'))
    await fixture.entered.promise
    app.gateway.steer(say('论文的消融实验怎么分组'))
    // The thesis topic answers while the Qwen reply is still running.
    await until(() => fixture.log.includes('thesis'))
    assert.deepEqual(fixture.log, ['qwen:1', 'thesis'])
    const mid = fixture.routed.at(-1)!
    assert.equal(mid.running?.topicId, 'ctx_qwen_9070xt')
    assert.equal(mid.running?.request, 'Qwen 那个')
    assert.equal(mid.running?.progress, 'Qwen 正在测')
    fixture.release.resolve()
    await until(() => replies(app.gateway).length === 2 && app.gateway.status === 'idle')
    await app.gateway.whenIdle()
    // Main chat reads as one conversation, question then answer, and the reply was not mixed with it.
    assert.deepEqual(asked(app.gateway), ['Qwen 那个', '论文的消融实验怎么分组'])
    assert.deepEqual(replies(app.gateway), ['Qwen 正在测', '论文回答'])
    assert.doesNotMatch(fixture.qwenSaw(), /论文/)
    assert.equal(app.ctx.theone.store.current('test-gateway'), 'ctx_thesis')
    const routes = app.ctx.theone.store.recentRoutes('test-gateway')
    assert.ok(routes.every(route => route.status === 'completed'), JSON.stringify(routes))
  } finally { fixture.release.resolve(); await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('an interjection about the running reply still reaches it', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-mid-same-'))
  const fixture = setup()
  const app = await harness(root, fixture.model, { routerMode: 'llm', autoModel: true })
  try {
    app.gateway.followup(say('Qwen 那个'))
    await fixture.entered.promise
    app.gateway.steer(say('Qwen 换成 14B'))
    await until(() => fixture.routed.length === 2)
    fixture.release.resolve()
    await until(() => app.gateway.status === 'idle' && replies(app.gateway).length >= 2)
    assert.deepEqual(replies(app.gateway), ['Qwen 正在测', 'Qwen 补充：14B'])
    assert.ok(!fixture.log.includes('thesis'))
  } finally { fixture.release.resolve(); await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('a queued message about another matter starts now; deleting it from the queue stops that work', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-mid-queued-'))
  const fixture = setup()
  const app = await harness(root, fixture.model, { routerMode: 'llm', autoModel: true })
  try {
    app.gateway.followup(say('Qwen 那个'))
    await fixture.entered.promise
    const queued = say('论文的消融实验怎么分组')
    app.gateway.followup(queued)
    await until(() => fixture.log.includes('thesis'))
    assert.equal(app.ctx.theone.store.route(queued.id)?.status, 'running')
    // The topic in use does not change until main chat gets to the message.
    assert.equal(app.ctx.theone.store.current('test-gateway'), 'ctx_qwen_9070xt')
    app.gateway.inbox.remove(queued.id)
    assert.equal(app.ctx.theone.store.route(queued.id), undefined)
    fixture.release.resolve()
    await until(() => app.gateway.status === 'idle' && replies(app.gateway).length >= 1)
    await new Promise(resolve => setTimeout(resolve, 100))
    assert.deepEqual(asked(app.gateway), ['Qwen 那个'])
    assert.deepEqual(replies(app.gateway), ['Qwen 正在测'])

    // Queued again and left: shown after the reply that was running, in send order.
    const second = setup()
    fixture.model.behavior = second.model.behavior
    app.gateway.followup(say('Qwen 那个'))
    await second.entered.promise
    app.gateway.followup(say('论文的消融实验怎么分组'))
    await until(() => second.log.includes('thesis'))
    second.release.resolve()
    await until(() => app.gateway.status === 'idle' && replies(app.gateway).length === 3)
    assert.deepEqual(replies(app.gateway), ['Qwen 正在测', 'Qwen 正在测', '论文回答'])
  } finally { fixture.release.resolve(); await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('a queued message for the busy topic waits its turn; background work still running is shown live', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-mid-wait-'))
  const fixture = setup()
  const thesisRelease = Promise.withResolvers<void>()
  const base = fixture.model.behavior!
  fixture.model.behavior = async function* (options) {
    if (topicOf(options) === 'ctx_thesis') { fixture.log.push('thesis'); await thesisRelease.promise; yield* textResponse('论文回答'); return }
    yield* base(options)
  }
  const app = await harness(root, fixture.model, { routerMode: 'llm', autoModel: true })
  try {
    app.gateway.followup(say('Qwen 那个'))
    await fixture.entered.promise
    app.gateway.followup(say('Qwen 换成 14B 再测一次'))
    app.gateway.followup(say('论文的消融实验怎么分组'))
    await until(() => fixture.log.includes('thesis') && fixture.routed.length === 3)
    // The Qwen topic is busy: its message waits; the thesis topic started at once.
    assert.deepEqual(fixture.log, ['qwen:1', 'thesis'])
    fixture.release.resolve()
    await until(() => replies(app.gateway).length === 2)
    assert.equal(replies(app.gateway)[1], 'Qwen 补充：14B')
    // Main chat reaches the thesis message while its topic still works: it waits on that work.
    await new Promise(resolve => setTimeout(resolve, 100))
    assert.equal(app.gateway.status, 'running')
    thesisRelease.resolve()
    await until(() => app.gateway.status === 'idle' && replies(app.gateway).length === 3)
    assert.deepEqual(asked(app.gateway), ['Qwen 那个', 'Qwen 换成 14B 再测一次', '论文的消融实验怎么分组'])
    assert.deepEqual(replies(app.gateway), ['Qwen 正在测', 'Qwen 补充：14B', '论文回答'])
  } finally { fixture.release.resolve(); thesisRelease.resolve(); await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('a todo list written by background work shows in main chat once it gets to that work', { timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-mid-todo-'))
  const fixture = setup()
  const base = fixture.model.behavior!
  const app = await harness(root, fixture.model, { routerMode: 'llm', autoModel: true })
  fixture.model.behavior = async function* (options) {
    if (topicOf(options) === 'ctx_thesis') {
      const worker = app.ctx.agents.get(SessionId(options.sessionId!))!
      ;(worker.session as unknown as { append(type: string, data: unknown): void }).append('todo/write', { todos: [{ content: '分组', status: 'in_progress' }] })
    }
    yield* base(options)
  }
  const todos = () => app.gateway.session.snapshotEvents().filter(event => (event as { type: string }).type === 'todo/write')
  try {
    app.gateway.followup(say('Qwen 那个'))
    await fixture.entered.promise
    app.gateway.followup(say('论文的消融实验怎么分组'))
    await until(() => fixture.log.includes('thesis'))
    await new Promise(resolve => setTimeout(resolve, 50))
    assert.equal(todos().length, 0)
    fixture.release.resolve()
    await until(() => app.gateway.status === 'idle' && replies(app.gateway).length === 2)
    assert.equal(todos().length, 1)
  } finally { fixture.release.resolve(); await app.close(); await rm(root, { recursive: true, force: true }) }
})

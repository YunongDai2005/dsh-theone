import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import { ROUTING_PROMPT } from '../src/llm-router.ts'
import { harness, ask, FixtureModel, textResponse } from './harness.ts'

const routeTo = (contextId: string) => JSON.stringify({ action: 'EXISTING', contextId, title: null, question: null, reason: 'test', historyIndependent: null, candidateIds: [], relatedIds: [] })
/** The topic a Worker request is for, from its TheOne briefing. */
const topicOf = (options: GenerateOptions) => {
  const briefing = options.messages.find(message => 'source' in message && message.source?.kind === 'theone-context')
  return briefing && 'source' in briefing && briefing.source?.kind === 'theone-context' ? briefing.source.contextId : undefined
}

test('a topic that is handed a message not its own gives it back, and main chat shows the right topic\'s answer', { timeout: 60000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-handback-'))
  const model = new FixtureModel()
  let handbacks = 0
  model.behavior = async function* (options) {
    if (options.system?.startsWith(ROUTING_PROMPT)) {
      const payload = JSON.parse((options.messages[0] as unknown as { content: { text: string }[] }).content[0].text)
      // The quick look always picks the GPU topic; asked again without it, the thesis.
      const ids = payload.contexts.map((context: { id: string }) => context.id)
      yield* textResponse(routeTo(ids.includes('ctx_qwen_9070xt') ? 'ctx_qwen_9070xt' : 'ctx_thesis'))
      return
    }
    const topic = topicOf(options)
    const toolResults = options.messages.filter(message => message.role === 'tool').length
    if (topic === 'ctx_qwen_9070xt' && !toolResults) {
      handbacks++
      const id = ToolCallId(`handback-${handbacks}`)
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'theone_handback', arguments: JSON.stringify({ reason: '这是论文的事' }) } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    } else yield* textResponse(topic === 'ctx_thesis' ? '论文的回答' : '好')
  }
  const app = await harness(root, model, { routerMode: 'llm' })
  try {
    const result = await ask(app.gateway, '消融实验的表格怎么排')
    assert.equal(result.end?.data.reason.kind, 'completed')
    assert.equal(result.output, '论文的回答', 'main chat shows only the right topic\'s answer')
    const store = app.ctx.theone.store
    const decision = store.route(result.input.id)?.decision
    assert.equal(decision?.contextId, 'ctx_thesis')
    assert.match(decision?.reason ?? '', /^handback:/)
    assert.equal(store.current('test-gateway'), 'ctx_thesis')
    assert.equal(store.topicRun(result.input.id)?.contextId, 'ctx_thesis')
    // The GPU topic's turn stops counting as its own, and it is not told again (it gave the message back itself).
    const deadline = Date.now() + 5000
    while (!store.misroutes('ctx_qwen_9070xt').length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10))
    assert.equal(store.misroutes('ctx_qwen_9070xt').length, 1)
    assert.equal(store.hasFlag(`misroute:${result.input.id}`), true)
    // Nothing was said to the user about it.
    assert.ok(!result.events.some(event => event.type === 'user/message' && event.data.source.kind === 'theone-note'))
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

test('a message is handed back at most once; the second topic answers it whatever it says', { timeout: 60000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'theone-handback-once-'))
  const model = new FixtureModel()
  model.behavior = async function* (options) {
    if (options.system?.startsWith(ROUTING_PROMPT)) {
      const payload = JSON.parse((options.messages[0] as unknown as { content: { text: string }[] }).content[0].text)
      const ids = payload.contexts.map((context: { id: string }) => context.id)
      yield* textResponse(routeTo(ids.includes('ctx_qwen_9070xt') ? 'ctx_qwen_9070xt' : 'ctx_thesis'))
      return
    }
    // Every topic tries to hand the message back once; the second refusal is answered.
    const results = options.messages.filter(message => message.role === 'tool')
    if (!results.length) {
      const id = ToolCallId(`handback-${topicOf(options)}`)
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'theone_handback', arguments: JSON.stringify({ reason: '不是我的' }) } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    } else {
      const said = JSON.stringify(results.at(-1))
      yield* textResponse(said.includes('Not handed back') ? `${topicOf(options)} 照常回答` : '好')
    }
  }
  const app = await harness(root, model, { routerMode: 'llm' })
  try {
    const result = await ask(app.gateway, '这个怎么弄')
    assert.equal(result.output, 'ctx_thesis 照常回答')
    assert.equal(app.ctx.theone.store.route(result.input.id)?.decision.contextId, 'ctx_thesis')
  } finally { await app.close(); await rm(root, { recursive: true, force: true }) }
})

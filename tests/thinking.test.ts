import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ToolCallId, resolveRetryPolicy, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { harness, ask, FixtureModel, textResponse } from './harness.ts'

function* thinking(text: string, index = 0): Generator<StreamChunk> {
  yield {type:'block-start',index,blockType:'reasoning'}
  yield {type:'reasoning-delta',index,text}
  yield {type:'block-end',index,block:{type:'reasoning',text}}
}
function* answer(text: string): Generator<StreamChunk> {
  for (const chunk of textResponse(text)) yield 'index' in chunk ? {...chunk,index:1} : chunk
}
function content(result: Awaited<ReturnType<typeof ask>>) {
  return result.events.flatMap(e => e.type === 'assistant/message' ? e.data.message.content : [])
}
/** Reasoning text the main chat has streamed live, in the order it appeared. */
function liveReasoning(app: Awaited<ReturnType<typeof harness>>) {
  const seen: string[] = []
  app.ctx.on('agent/assistant-stream',({agent,frame}) => {
    if (agent.id === app.gateway.id && frame.type === 'chunk' && frame.chunk.type === 'reasoning-delta') seen.push(frame.chunk.text)
  })
  return seen
}

test('main chat retains committed reasoning separately from answer text and across reload', {timeout:30000}, async () => {
  const root = await mkdtemp(join(tmpdir(),'theone-thinking-blocks-'))
  const app = await harness(root)
  try {
    app.model.behavior = async function* () {
      // Interleaved deltas and closing order must not move reasoning into answer text.
      yield {type:'block-start',index:0,blockType:'reasoning'}
      yield {type:'block-start',index:1,blockType:'text'}
      yield {type:'reasoning-delta',index:0,text:'模型提供的思考。'}
      yield {type:'text-delta',index:1,text:'最终回答。'}
      yield {type:'block-end',index:1,block:{type:'text',text:'最终回答。'}}
      yield {type:'block-end',index:0,block:{type:'reasoning',text:'模型提供的思考。'}}
      yield {type:'finish',reason:{kind:'stop'}}
    }
    const result = await ask(app.gateway,'Qwen 那个')
    assert.equal(result.output,'最终回答。')
    assert.deepEqual(content(result),[{type:'reasoning',text:'模型提供的思考。'},{type:'text',text:'最终回答。'}])
    const log = await app.ctx.sessionQuery.readSession(app.gateway.id)
    const durable = log.events.flatMap(e => e.type === 'assistant/message' ? e.data.message.content : [])
    assert.deepEqual(durable,content(result))
  } finally {await app.close();await rm(root,{recursive:true,force:true})}
})

test('thinking streams into the main-chat message before any reply text, in its native place', {timeout:30000}, async () => {
  const root = await mkdtemp(join(tmpdir(),'theone-thinking-live-'))
  const app = await harness(root)
  const seen = liveReasoning(app)
  const reasoned = Promise.withResolvers<void>(), release = Promise.withResolvers<void>()
  try {
    app.model.behavior = async function* () {
      yield* thinking('还在想，没有开始回答')
      reasoned.resolve();await release.promise
      yield* answer('想好了')
    }
    const pending = ask(app.gateway,'Qwen 那个')
    await reasoned.promise
    assert.deepEqual(seen,['还在想，没有开始回答'])
    assert.equal(app.gateway.session.snapshotEvents().filter(e => e.type === 'assistant/message').length,0)
    release.resolve()
    const result = await pending
    assert.deepEqual(content(result).map(b => b.type),['reasoning','text'])
  } finally {release.resolve();await app.close();await rm(root,{recursive:true,force:true})}
})

test('a retried attempt replaces its thinking on screen; only the successful thinking is saved', {timeout:30000}, async () => {
  class RetryingModel extends FixtureModel {
    override providerRetryPolicy() {return resolveRetryPolicy({mode:'normal',maxRetries:1},'fixture.retry')}
  }
  const root = await mkdtemp(join(tmpdir(),'theone-thinking-retry-'))
  const app = await harness(root,new RetryingModel())
  const seen = liveReasoning(app)
  const first = Promise.withResolvers<void>(), finishFirst = Promise.withResolvers<void>()
  let attempt = 0
  // Exercise DSH's real request recovery extension without a timer/backoff plugin.
  app.ctx.on('agent/request-error', async (payload,next) => {
    if (payload.failure.code === 'TEST_RETRY' && attempt === 1) return {kind:'retry' as const}
    return next()
  })
  app.model.behavior = async function* () {
    const current = ++attempt
    yield* thinking(current === 1 ? '失败尝试的临时思考' : '第二次成功尝试的思考')
    if (current === 1) {
      first.resolve();await finishFirst.promise
      yield {type:'finish',reason:{kind:'error',failure:{code:'TEST_RETRY',message:'synthetic transient error',status:503}}}
    } else yield* answer('重试后的回答')
  }
  try {
    const pending = ask(app.gateway,'Qwen 那个')
    await first.promise
    assert.deepEqual(seen,['失败尝试的临时思考'])
    finishFirst.resolve()
    const result = await pending
    assert.equal(result.output,'重试后的回答')
    assert.deepEqual(seen,['失败尝试的临时思考','第二次成功尝试的思考'])
    assert.ok(!JSON.stringify(content(result)).includes('失败尝试'))
    assert.ok(JSON.stringify(content(result)).includes('第二次成功尝试'))
  } finally {finishFirst.resolve();await app.close();await rm(root,{recursive:true,force:true})}
})

test('each step keeps its own thinking next to its tool card, and the tool runs only once', {timeout:30000}, async () => {
  const root = await mkdtemp(join(tmpdir(),'theone-thinking-tools-'))
  const app = await harness(root)
  let calls = 0
  try {
    app.ctx.tools.register(defineTool({name:'thinking_counter',description:'Synthetic counter',parameters:{},
      output:{schema:{type:'string'},render:(_args,value:string)=>[{type:'text',text:value}]},
      execute:async()=>{calls++;return 'complete'}}))
    app.model.behavior = async function* () {
      if (!calls) {
        yield* thinking('执行测试工具前的思考')
        const id = ToolCallId('thinking-test-call')
        yield {type:'block-start',index:1,blockType:'tool-call'}
        yield {type:'tool-call-delta',index:1,id,name:'thinking_counter',argumentsDelta:'{}'}
        yield {type:'block-end',index:1,block:{type:'tool-call',id,name:'thinking_counter',arguments:'{}'}}
        yield {type:'finish',reason:{kind:'tool-calls'}}
      } else {
        yield* thinking('测试完成后的思考')
        yield* answer('已完成')
      }
    }
    const result = await ask(app.gateway,'Qwen 那个')
    assert.equal(calls,1)
    assert.equal(result.output,'已完成')
    const steps = result.events.flatMap(e => e.type === 'assistant/message' ? [e.data.message.content.map(b => b.type)] : [])
    assert.deepEqual(steps,[['reasoning','tool-call'],['reasoning','text']])
  } finally {await app.close();await rm(root,{recursive:true,force:true})}
})

test('cancellation and the reasoning size limit end the turn and record the failed route', {timeout:30000}, async () => {
  const root = await mkdtemp(join(tmpdir(),'theone-thinking-cancel-'))
  const app = await harness(root,undefined,{theoneConfig:{maxResponseChars:128}})
  const entered = Promise.withResolvers<void>()
  try {
    app.model.behavior = async function* (options) {
      yield* thinking('取消前的思考')
      entered.resolve()
      await new Promise<void>(resolve => options.signal?.addEventListener('abort',()=>resolve(),{once:true}))
      options.signal?.throwIfAborted()
    }
    const pending = ask(app.gateway,'Qwen 那个')
    await entered.promise
    app.gateway.cancel({kind:'user'})
    const cancelled = await pending
    assert.equal(cancelled.end?.data.reason.kind,'aborted')
    assert.equal(app.ctx.theone.store.route(cancelled.input.id)?.status,'failed')
    app.model.behavior = async function* () {yield* thinking('x'.repeat(129));yield* answer('不可输出')}
    const oversized = await ask(app.gateway,'继续')
    assert.equal(oversized.end?.data.reason.kind,'error')
    assert.equal(app.ctx.theone.store.route(oversized.input.id)?.status,'failed')
    app.model.behavior = async function* () {yield* answer('恢复正常')}
    assert.equal((await ask(app.gateway,'继续')).output,'恢复正常')
  } finally {await app.close();await rm(root,{recursive:true,force:true})}
})

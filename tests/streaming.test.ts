import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ToolCallId, resolveRetryPolicy, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { harness, ask, FixtureModel, textResponse } from './harness.ts'

test('reply text reaches native main-chat stream in pieces before worker commit, without duplication', {timeout:30000}, async () => {
  const root = await mkdtemp(join(tmpdir(),'theone-streaming-'))
  const app = await harness(root)
  const first = Promise.withResolvers<void>(), second = Promise.withResolvers<void>()
  const next = Promise.withResolvers<void>(), finish = Promise.withResolvers<void>()
  const chunks: StreamChunk[] = []
  app.ctx.on('agent/assistant-stream',({agent,frame}) => {
    if (agent.id !== app.gateway.id || frame.type !== 'chunk') return
    chunks.push(frame.chunk)
    if (frame.chunk.type === 'text-delta' && frame.chunk.text === '第一段，') first.resolve()
    if (frame.chunk.type === 'text-delta' && frame.chunk.text === '第二段。') second.resolve()
  })
  app.model.behavior = async function* () {
    yield {type:'block-start',index:0,blockType:'reasoning'}
    yield {type:'reasoning-delta',index:0,text:'模型返回的思考'}
    yield {type:'block-end',index:0,block:{type:'reasoning',text:'模型返回的思考'}}
    yield {type:'block-start',index:1,blockType:'text'}
    yield {type:'text-delta',index:1,text:'第一段，'}
    await next.promise
    yield {type:'text-delta',index:1,text:'第二段。'}
    await finish.promise
    yield {type:'block-end',index:1,block:{type:'text',text:'第一段，第二段。'}}
    yield {type:'finish',reason:{kind:'stop'}}
  }
  try {
    const pending = ask(app.gateway,'Qwen 那个')
    await first.promise
    assert.equal(app.gateway.session.snapshotEvents().filter(e=>e.type === 'assistant/message').length,0)
    // The reply block stays open until the Worker closes it, exactly as the model streams it.
    assert.ok(!chunks.some(c=>c.type === 'block-end' && c.block.type === 'text'))
    next.resolve()
    await second.promise
    assert.equal(app.gateway.session.snapshotEvents().filter(e=>e.type === 'assistant/message').length,0)
    finish.resolve()
    const result = await pending
    assert.equal(result.output,'第一段，第二段。')
    assert.equal(result.end?.data.reason.kind,'completed')
    assert.deepEqual(chunks.filter(c=>c.type === 'text-delta').map(c=>c.text),['第一段，','第二段。'])
    const content = result.events.flatMap(e=>e.type === 'assistant/message' ? e.data.message.content : [])
    assert.deepEqual(content,[{type:'reasoning',text:'模型返回的思考'},{type:'text',text:'第一段，第二段。'}])
    const log = await app.ctx.sessionQuery.readSession(app.gateway.id)
    assert.deepEqual(log.events.flatMap(e=>e.type === 'assistant/message' ? e.data.message.content : []),content)
  } finally {next.resolve();finish.resolve();await app.close();await rm(root,{recursive:true,force:true})}
})

test('a Worker retry after live text redoes the main-chat attempt, showing only the reply that succeeded', {timeout:30000}, async () => {
  class RetryingModel extends FixtureModel {
    override providerRetryPolicy() {return resolveRetryPolicy({mode:'normal',maxRetries:1},'fixture.retry')}
  }
  const root = await mkdtemp(join(tmpdir(),'theone-streaming-retry-'))
  const app = await harness(root,new RetryingModel())
  const visible = Promise.withResolvers<void>(), fail = Promise.withResolvers<void>()
  let attempts = 0
  app.ctx.on('agent/request-error',async (payload,next) => payload.failure.code === 'STREAM_TEST_RETRY' && attempts === 1 ? {kind:'retry' as const} : next())
  app.ctx.on('agent/assistant-stream',({agent,frame}) => {
    if (agent.id === app.gateway.id && frame.type === 'chunk' && frame.chunk.type === 'text-delta') visible.resolve()
  })
  app.model.behavior = async function* () {
    if (++attempts === 1) {
      yield {type:'block-start',index:0,blockType:'text'}
      yield {type:'text-delta',index:0,text:'中断前的片段'}
      await fail.promise
      yield {type:'finish',reason:{kind:'error',failure:{code:'STREAM_TEST_RETRY',message:'synthetic disconnection',status:503}}}
    } else yield* textResponse('重试后的完整回答')
  }
  try {
    const pending = ask(app.gateway,'Qwen 那个')
    await visible.promise
    fail.resolve()
    const result = await pending
    assert.equal(attempts,2)
    assert.equal(result.end?.data.reason.kind,'completed',JSON.stringify(result.end))
    assert.equal(result.output,'重试后的完整回答')
    // The interrupted text is kept only as a superseded attempt, like a native retry.
    assert.ok(result.events.some(e=>e.type === 'assistant/attempt'))
    assert.ok(!JSON.stringify(result.events.filter(e=>e.type === 'assistant/message')).includes('中断前的片段'))
    assert.equal(app.ctx.theone.store.route(result.input.id)?.status,'completed')
  } finally {fail.resolve();await app.close();await rm(root,{recursive:true,force:true})}
})

test('a Worker failure after live text ends the main-chat turn with an error; the next turn works', {timeout:30000}, async () => {
  const root = await mkdtemp(join(tmpdir(),'theone-streaming-failure-'))
  const app = await harness(root)
  const visible = Promise.withResolvers<void>(), fail = Promise.withResolvers<void>()
  app.ctx.on('agent/assistant-stream',({agent,frame}) => {
    if (agent.id === app.gateway.id && frame.type === 'chunk' && frame.chunk.type === 'text-delta') visible.resolve()
  })
  app.model.behavior = async function* () {
    yield {type:'block-start',index:0,blockType:'text'}
    yield {type:'text-delta',index:0,text:'中断前的片段'}
    await fail.promise
    yield {type:'finish',reason:{kind:'error',failure:{code:'STREAM_TEST_FATAL',message:'synthetic failure',status:400}}}
  }
  try {
    const pending = ask(app.gateway,'Qwen 那个')
    await visible.promise
    fail.resolve()
    const result = await pending
    assert.equal(result.end?.data.reason.kind,'error')
    assert.equal(result.output,'')
    assert.equal(app.ctx.theone.store.route(result.input.id)?.status,'failed')
    const workerId = app.ctx.theone.store.contexts().find(c=>c.id === 'ctx_qwen_9070xt')!.workingSessionId
    assert.equal(app.ctx.agents.get(workerId as typeof app.gateway.id)?.status,'idle')
    app.model.behavior = async function* () {yield* textResponse('下一次可以正常回答')}
    assert.equal((await ask(app.gateway,'继续')).output,'下一次可以正常回答')
  } finally {fail.resolve();await app.close();await rm(root,{recursive:true,force:true})}
})

test('each Worker step is its own main-chat step with a tool card; the tool runs once', {timeout:30000}, async () => {
  const root = await mkdtemp(join(tmpdir(),'theone-streaming-tools-'))
  const app = await harness(root)
  let calls = 0
  const textIndexes: number[] = []
  app.ctx.on('agent/assistant-stream',({agent,frame}) => {
    if (agent.id === app.gateway.id && frame.type === 'chunk' && frame.chunk.type === 'text-delta') textIndexes.push(frame.chunk.index)
  })
  try {
    app.ctx.tools.register(defineTool({name:'stream_counter',description:'Synthetic counter',parameters:{},
      output:{schema:{type:'string'},render:(_args,value:string)=>[{type:'text',text:value}]},
      execute:async()=>{calls++;return 'complete'}}))
    app.model.behavior = async function* () {
      if (!calls) {
        // A tool step may contain explanatory text, followed by a fresh step whose
        // model indexes start at zero again. Neither text nor tools can replay.
        yield {type:'block-start',index:0,blockType:'text'}
        yield {type:'text-delta',index:0,text:'正在处理。'}
        yield {type:'block-end',index:0,block:{type:'text',text:'正在处理。'}}
        const id = ToolCallId('stream-tool')
        yield {type:'block-start',index:1,blockType:'tool-call'}
        yield {type:'tool-call-delta',index:1,id,name:'stream_counter',argumentsDelta:'{}'}
        yield {type:'block-end',index:1,block:{type:'tool-call',id,name:'stream_counter',arguments:'{}'}}
        yield {type:'finish',reason:{kind:'tool-calls'}}
      } else yield* textResponse('已经完成。')
    }
    const result = await ask(app.gateway,'Qwen 那个')
    assert.equal(result.end?.data.reason.kind,'completed')
    assert.equal(result.output,'正在处理。已经完成。')
    assert.equal(calls,1)
    assert.equal(textIndexes.length,2)
    const messages = result.events.filter(e=>e.type === 'assistant/message')
    assert.deepEqual(messages.map(e=>e.type === 'assistant/message' && e.data.message.content.map(b=>b.type)),[['text','tool-call'],['text']])
    assert.deepEqual(result.events.filter(e=>e.type === 'tool/call').map(e=>e.type === 'tool/call' && e.data.name),['stream_counter'])
  } finally {await app.close();await rm(root,{recursive:true,force:true})}
})

test('cancelling a streamed reply stops its worker and permits the next request', {timeout:30000}, async () => {
  const root = await mkdtemp(join(tmpdir(),'theone-streaming-cancel-'))
  const app = await harness(root)
  const visible = Promise.withResolvers<void>()
  let cancelled = false
  app.ctx.on('agent/assistant-stream',({agent,frame}) => {
    if (agent.id === app.gateway.id && frame.type === 'chunk' && frame.chunk.type === 'text-delta') visible.resolve()
  })
  app.model.behavior = async function* (options) {
    yield {type:'block-start',index:0,blockType:'text'}
    yield {type:'text-delta',index:0,text:'还没写完的回答'}
    await new Promise<void>(resolve=>{
      const abort = () => {cancelled=true;resolve()}
      if (options.signal?.aborted) abort()
      else options.signal?.addEventListener('abort',abort,{once:true})
    })
    options.signal?.throwIfAborted()
  }
  try {
    const pending = ask(app.gateway,'Qwen 那个')
    await visible.promise
    app.gateway.cancel({kind:'user'})
    const result = await pending
    assert.equal(result.end?.data.reason.kind,'aborted')
    assert.equal(cancelled,true)
    assert.equal(app.ctx.theone.store.route(result.input.id)?.status,'failed')
    assert.ok(result.events.some(e=>e.type === 'assistant/message' && e.data.interrupted))
    app.model.behavior = async function* () {yield* textResponse('取消后仍然可用')}
    assert.equal((await ask(app.gateway,'继续')).output,'取消后仍然可用')
  } finally {await app.close();await rm(root,{recursive:true,force:true})}
})

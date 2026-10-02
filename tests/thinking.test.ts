import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ToolCallId, resolveRetryPolicy, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
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
function previewChannel(app: Awaited<ReturnType<typeof harness>>) {
  const connection = new HostConnectionService(app.ctx,[],undefined as never)
  const handler = connection.createSharedFetchHandler('/api')
  const response = (id: string = app.gateway.id) => {
    const url = new URL('http://dsh.internal/api/theone/thinking?sessionId='+encodeURIComponent(id))
    // The native HTTP bridge otherwise treats GET as streaming and rejects its body.
    assert.equal(handler.requestBodyMode({method:'GET',url}),'buffered')
    return handler.fetch(new Request(url))
  }
  const snapshot = async (id?: string) => (await response(id)).json()
  return {connection,response,snapshot}
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

test('live thinking exists before commit; failed-attempt preview resets and is never saved as successful thinking', {timeout:30000}, async () => {
  class RetryingModel extends FixtureModel {
    override providerRetryPolicy() {return resolveRetryPolicy({mode:'normal',maxRetries:1},'fixture.retry')}
  }
  const root = await mkdtemp(join(tmpdir(),'theone-thinking-retry-'))
  const app = await harness(root,new RetryingModel())
  const {response,snapshot} = previewChannel(app)
  const first = Promise.withResolvers<void>(), second = Promise.withResolvers<void>()
  const finishFirst = Promise.withResolvers<void>(), finishSecond = Promise.withResolvers<void>()
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
    } else {
      second.resolve();await finishSecond.promise
      yield* answer('重试后的回答')
    }
  }
  try {
    await new Promise<void>(resolve => setImmediate(resolve))
    const pending = ask(app.gateway,'Qwen 那个')
    await first.promise
    const live = await snapshot()
    assert.equal(live.active,true);assert.equal(live.text,'失败尝试的临时思考')
    assert.equal((await response()).headers.get('cache-control'),'no-store')
    assert.equal((await snapshot('other-session')).active,false)
    assert.equal((await snapshot('other-session')).text,'')
    assert.equal((await response('bad/id')).status,400)
    assert.equal(app.gateway.session.snapshotEvents().filter(e => e.type === 'assistant/message').length,0)
    finishFirst.resolve()
    await Promise.race([second.promise,pending.then(()=>{throw new Error('Worker did not retry')})])
    const retried = await snapshot()
    assert.equal(retried.text,'第二次成功尝试的思考')
    assert.notEqual(retried.attemptId,live.attemptId)
    finishSecond.resolve()
    const result = await pending
    assert.equal(result.output,'重试后的回答')
    assert.ok(!JSON.stringify(content(result)).includes('失败尝试'))
    assert.ok(JSON.stringify(content(result)).includes('第二次成功尝试'))
    assert.equal((await snapshot()).active,false)
    assert.equal((await snapshot()).text,'')
  } finally {finishFirst.resolve();finishSecond.resolve();await app.close();await rm(root,{recursive:true,force:true})}
})

test('reasoning across tool steps is shown while tools execute only once in the Worker', {timeout:30000}, async () => {
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
        yield {type:'block-start',index:1,blockType:'text'}
        yield {type:'text-delta',index:1,text:'已完成'}
        yield {type:'block-end',index:1,block:{type:'text',text:'已完成'}}
        yield {type:'finish',reason:{kind:'stop'}}
      }
    }
    const result = await ask(app.gateway,'Qwen 那个')
    assert.equal(calls,1)
    assert.equal(result.output,'已完成')
    assert.deepEqual(content(result).map(b=>b.type),['reasoning','reasoning','text'])
    assert.ok(!result.events.some(e=>e.type === 'tool/call'))
  } finally {await app.close();await rm(root,{recursive:true,force:true})}
})

test('preview hides reasoning once it is in the main-chat message, during tools and after reply text starts', {timeout:30000}, async () => {
  const root = await mkdtemp(join(tmpdir(),'theone-thinking-handoff-'))
  const app = await harness(root)
  const {snapshot} = previewChannel(app)
  const toolEntered = Promise.withResolvers<void>(), releaseTool = Promise.withResolvers<void>()
  const reasoned = Promise.withResolvers<void>(), releaseText = Promise.withResolvers<void>()
  const textStarted = Promise.withResolvers<void>(), releaseEnd = Promise.withResolvers<void>()
  let calls = 0
  try {
    app.ctx.tools.register(defineTool({name:'thinking_gate',description:'Synthetic gate',parameters:{},
      output:{schema:{type:'string'},render:(_args,value:string)=>[{type:'text',text:value}]},
      execute:async()=>{calls++;toolEntered.resolve();await releaseTool.promise;return 'complete'}}))
    app.model.behavior = async function* () {
      if (!calls) {
        yield* thinking('工具前的思考')
        const id = ToolCallId('thinking-gate-call')
        yield {type:'block-start',index:1,blockType:'tool-call'}
        yield {type:'tool-call-delta',index:1,id,name:'thinking_gate',argumentsDelta:'{}'}
        yield {type:'block-end',index:1,block:{type:'tool-call',id,name:'thinking_gate',arguments:'{}'}}
        yield {type:'finish',reason:{kind:'tool-calls'}}
      } else {
        yield* thinking('回答前的思考')
        reasoned.resolve();await releaseText.promise
        yield {type:'block-start',index:1,blockType:'text'}
        yield {type:'text-delta',index:1,text:'开始'}
        textStarted.resolve();await releaseEnd.promise
        yield {type:'block-end',index:1,block:{type:'text',text:'开始'}}
        yield {type:'finish',reason:{kind:'stop'}}
      }
    }
    const pending = ask(app.gateway,'Qwen 那个')
    await toolEntered.promise
    assert.equal((await snapshot()).text,'')
    releaseTool.resolve()
    await reasoned.promise
    const live = await snapshot()
    assert.equal(live.active,true);assert.equal(live.text,'回答前的思考')
    releaseText.resolve()
    await textStarted.promise
    assert.equal((await snapshot()).text,'')
    releaseEnd.resolve()
    const result = await pending
    assert.equal(result.output,'开始')
    assert.deepEqual(content(result).map(b=>b.type),['reasoning','reasoning','text'])
  } finally {releaseTool.resolve();releaseText.resolve();releaseEnd.resolve();await app.close();await rm(root,{recursive:true,force:true})}
})

test('cancellation and reasoning size limits clear transient preview and preserve route failure', {timeout:30000}, async () => {
  const root = await mkdtemp(join(tmpdir(),'theone-thinking-cancel-'))
  const app = await harness(root,undefined,{theoneConfig:{maxResponseChars:128}})
  const {snapshot} = previewChannel(app)
  const entered = Promise.withResolvers<void>()
  try {
    app.model.behavior = async function* (options) {
      yield* thinking('取消前的临时思考')
      entered.resolve()
      await new Promise<void>(resolve => options.signal?.addEventListener('abort',()=>resolve(),{once:true}))
      options.signal?.throwIfAborted()
    }
    const pending = ask(app.gateway,'Qwen 那个')
    await entered.promise
    assert.equal((await snapshot()).active,true)
    app.gateway.cancel({kind:'user'})
    const cancelled = await pending
    assert.equal(cancelled.end?.data.reason.kind,'aborted')
    assert.equal((await snapshot()).active,false)
    app.model.behavior = async function* () {yield* thinking('x'.repeat(129));yield* answer('不可输出')}
    const oversized = await ask(app.gateway,'继续')
    assert.equal(oversized.end?.data.reason.kind,'error')
    assert.equal(app.ctx.theone.store.route(oversized.input.id)?.status,'failed')
    assert.equal((await snapshot()).text,'')
  } finally {await app.close();await rm(root,{recursive:true,force:true})}
})

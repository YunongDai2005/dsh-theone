import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {SessionId} from '@deepseek-ai/dsh-session'
import {DshRouter,RouterFailure,ROUTING_PROMPT,validateRoutingDecision,routingPayload} from '../src/llm-router.ts'
import {harness,ask,FixtureModel,textResponse} from './harness.ts'
const catalog=[{id:'topic',title:'研究',summary:'研究工作',entities:['研究'],keywords:[],lastState:'进行中'},
 {id:'other',title:'购物',summary:'购物清单',entities:['购物'],keywords:[],lastState:'进行中'}]
const input={text:'继续',contexts:catalog,currentId:'topic'}
const decision={action:'EXISTING',contextId:'topic',title:null,question:null,reason:'继续当前工作'}
type Chunk=import('@deepseek-ai/dsh-llm').StreamChunk
/** A model service whose only model answers with `reply`; counts calls. */
function service(reply:(options:{messages:unknown[];tools?:unknown;signal?:AbortSignal})=>AsyncIterable<Chunk>|Iterable<Chunk>){
 const state={calls:0}
 const llm={resolveModelInfo:async(provider:string,id:string)=>({provider,id,name:id}),
  prepareCall:async(config:{provider:string;model:string})=>({config,stream:(options:{messages:unknown[];signal?:AbortSignal})=>{state.calls++;return reply(options)}})}
 return {state,router:(now?:()=>number)=>new DshRouter(llm as never,()=>({provider:'fixture',model:'router-model'}),30000,now)}
}
const finished=(kind:string,status?:number):Chunk=>({type:'finish',reason:kind==='error'?{kind:'error',failure:{code:'HTTP',message:'private upstream text',status}}:{kind}} as Chunk)
/** The model's own text worker reply; routing requests answer through `route`. */
function routed(route:(payload:ReturnType<typeof routingPayload>,signal?:AbortSignal)=>Promise<unknown>){
 return async function*(options:import('@deepseek-ai/dsh-llm').GenerateOptions):AsyncIterable<Chunk>{
  if(options.system===ROUTING_PROMPT){
   const text=(options.messages[0] as unknown as {content:{text:string}[]}).content[0].text
   yield* textResponse(JSON.stringify(await route(JSON.parse(text),options.signal)));return
  }
  const descriptor=[...options.messages].reverse().find(message=>'source' in message && message.source?.kind==='theone-context')
  yield* textResponse(`模拟回答：${descriptor && 'source' in descriptor && descriptor.source?.kind==='theone-context'?descriptor.source.contextId:'?'}`)
 }
}
test('unknown targets and duplicate creations never reach the store',()=>{
 for(const value of [
  {...decision,contextId:'missing'}, {...decision,action:'SWAP'}, {...decision,action:'MOUNT'},
  {...decision,action:'KEEP',contextId:'other'}, {...decision,action:'CREATE',title:'new'},
  {...decision,action:'CLARIFY',question:'which?'},
  {action:'CREATE',contextId:null,title:'研究',question:null,reason:'duplicate'},
 ]) assert.throws(()=>validateRoutingDecision(value,input),RouterFailure)
 assert.equal(validateRoutingDecision(decision,{...input,currentId:undefined}).action,'MOUNT')
 assert.equal(validateRoutingDecision(decision,input).action,'KEEP')
 assert.equal(validateRoutingDecision({...decision,contextId:'other'},input).action,'SWAP')
 assert.equal(validateRoutingDecision({action:'CREATE',contextId:null,title:'摄影',question:null,reason:'新事项'},input).action,'CREATE')
})
test('classification sends redacted bounded data and has no tools',async()=>{
 const model=service(function*(options){
  const body=JSON.stringify(options.messages)
  assert.equal(options.tools,undefined)
  assert.equal(options.messages.length,1)
  for(const secret of ['sk-testsecret0123456789012345','private@example.com','192.168.1.20']) assert.ok(!body.includes(secret))
  yield* textResponse(JSON.stringify(decision))
 })
 const result=await model.router().decide({...input,text:'继续 sk-testsecret0123456789012345',recent:[{role:'assistant',text:'联系 private@example.com 192.168.1.20'}]})
 assert.equal(result.decision.action,'KEEP');assert.equal(result.model,'router-model');assert.equal(model.state.calls,1)
 assert.throws(()=>routingPayload({...input,text:'   '}),RouterFailure)
})
test('failed or truncated model output is not an executable route',async()=>{
 const truncated=service(function*(){yield {type:'text-delta',index:0,text:'{"action"'} as Chunk;yield finished('length')}).router()
 await assert.rejects(truncated.decide(input),error=>error instanceof RouterFailure && error.code==='ROUTER_RESPONSE_INCOMPLETE')
 const failed=service(function*(){yield finished('error',401)}).router()
 await assert.rejects(failed.decide(input),error=>error instanceof RouterFailure && error.code==='ROUTER_REQUEST_FAILED' && error.meta?.httpStatus===401 && !error.message.includes('private'))
})
test('unavailable routes cool down, probe again, and reset after success',async()=>{
 let time=1000,status=403
 const model=service(function*(){if(status===200)yield* textResponse(JSON.stringify(decision));else yield finished('error',status)})
 const client=model.router(()=>time)
 await assert.rejects(client.decide(input),error=>error instanceof RouterFailure && error.meta?.httpStatus===403)
 await assert.rejects(client.decide(input),error=>error instanceof RouterFailure && error.code==='ROUTER_CIRCUIT_OPEN' && error.meta?.retryAfterMs===60000)
 assert.equal(model.state.calls,1)
 time+=60000;status=200
 assert.equal((await client.decide(input)).decision.action,'KEEP')
 status=500
 for(let i=0;i<3;i++)await assert.rejects(client.decide(input),RouterFailure)
 await assert.rejects(client.decide(input),error=>error instanceof RouterFailure && error.code==='ROUTER_CIRCUIT_OPEN')
 assert.equal(model.state.calls,5)
})
test('caller cancellation does not mark the model unavailable',async()=>{
 const controller=new AbortController()
 const model=service(function*(){
  if(model.state.calls===1){controller.abort();throw controller.signal.reason}
  yield* textResponse(JSON.stringify(decision))
 })
 const client=model.router()
 await assert.rejects(client.decide(input,controller.signal))
 for(let i=0;i<3;i++)assert.equal((await client.decide(input)).decision.action,'KEEP')
 assert.equal(model.state.calls,4)
})

test('rebuilt Gateway recovers recent DSH references without copying chat into the routing database',async()=>{
 const root=await mkdtemp(join(tmpdir(),'theone-router-recovery-'))
 const payloads:ReturnType<typeof routingPayload>[]=[]
 const model=new FixtureModel()
 model.behavior=routed(async payload=>{payloads.push(payload);return {...decision,contextId:'ctx_qwen_9070xt'}})
 let app=await harness(root,model,{routerMode:'llm'})
 try{
  await ask(app.gateway,'Qwen 需要检查 ROCm 配置')
  const old=app.gateway.id
  await app.close();app=await harness(root,model,{routerMode:'llm'})
  assert.deepEqual(app.ctx.theone.store.recentGatewayIds('another-entry',app.gateway.id),[])
  assert.deepEqual(app.ctx.theone.store.recentGatewayIds('test-gateway',app.gateway.id),[old])
  const result=await ask(app.gateway,'检查一下 Qwen 的配置结果')
  assert.equal(result.end?.data.reason.kind,'completed')
  assert.ok(payloads.at(-1)!.recent?.some(message=>message.role==='user' && message.text==='Qwen 需要检查 ROCm 配置'))
  assert.ok(payloads.at(-1)!.recent?.some(message=>message.role==='assistant' && message.text.includes('ctx_qwen_9070xt')))
  assert.equal(app.ctx.theone.store.route(result.input.id)?.decision.action,'KEEP')
 }finally{
  await app.close()
  await rm(root,{recursive:true,force:true})
 }
})
test('gateway reserves admission during LLM classification; cancellation preserves state and invalid output falls back to rules', {timeout:30000},async()=>{
 const root=await mkdtemp(join(tmpdir(),'theone-llm-'))
 const entered=Promise.withResolvers<void>()
 let behavior:'pending'|'invalid'|'valid'='pending'
 const model=new FixtureModel()
 model.behavior=routed(async(_payload,signal)=>{
  if(behavior==='pending') {
   entered.resolve()
   await new Promise<void>(resolve=>{
    if(signal?.aborted)resolve();else signal?.addEventListener('abort',()=>resolve(),{once:true})
   })
   signal?.throwIfAborted()
  }
  return {action:'EXISTING',contextId:behavior==='invalid'?'unknown':'ctx_qwen_9070xt',title:null,question:null,reason:'测试路由'}
 })
 // Router receipts live on notices; this test shows every notice to read them.
 const app=await harness(root,model,{routerMode:'llm',theoneConfig:{routeNotice:'all'}})
 try {
  const pending=ask(app.gateway,'Qwen')
  await entered.promise
  const another=(await app.ctx.agents.create({sessionId:SessionId(randomUUID()),agentOptions:{provider:'theone',model:'gateway'}})).agent
  const competing=await ask(another,'论文')
  assert.equal(competing.end?.data.reason.kind,'error')
  assert.equal(app.ctx.theone.store.current('test-gateway'),undefined)
  app.gateway.cancel({kind:'user'})
  const cancelled=await pending
  assert.equal(cancelled.end?.data.reason.kind,'aborted')
  assert.equal(app.ctx.theone.store.route(cancelled.input.id),undefined)
  // An unusable classification is not a question back: the rules route it instead.
  behavior='invalid'
  const invalid=await ask(app.gateway,'Qwen')
  const fallback=app.ctx.theone.store.route(invalid.input.id)?.decision
  assert.equal(fallback?.action,'MOUNT')
  assert.equal(fallback?.contextId,'ctx_qwen_9070xt')
  assert.equal(fallback?.reason,'router-fallback:ROUTER_INVALID_DECISION')
  assert.equal(invalid.output,'模拟回答：ctx_qwen_9070xt')
  const invalidNotice=invalid.events.find(event=>event.type==='user/message' && event.data.source.kind==='theone-route')
  assert.ok(invalidNotice?.type==='user/message' && invalidNotice.data.source.kind==='theone-route')
  assert.equal(invalidNotice.data.source.router?.errorCode,'ROUTER_INVALID_DECISION')
  behavior='valid'
  const valid=await ask(app.gateway,'Qwen')
  assert.equal(valid.output,'模拟回答：ctx_qwen_9070xt')
  const notice=valid.events.find(event=>event.type==='user/message' && event.data.source.kind==='theone-route')
  assert.ok(notice?.type==='user/message' && notice.data.source.kind==='theone-route')
  assert.equal(notice.data.source.router?.model,'fixture')
  assert.equal(notice.data.source.router?.promptTokens,10)
 }finally{
  await app.close()
  await rm(root,{recursive:true,force:true})
 }
})


test('only a boolean historyIndependent flag can admit standalone CREATE during indexing', () => {
 const request = {...input, text:'继续上次的音频下载', historyIncomplete: true}
 const create = {action:'CREATE',contextId:null,title:'音频下载',question:null,reason:'完整链接可独立执行'}
 assert.equal(validateRoutingDecision({...create,historyIndependent:true},request).historyIndependent,true)
 assert.equal(validateRoutingDecision({...create,historyIndependent:false},request).historyIndependent,false)
 assert.equal(validateRoutingDecision(create,request).historyIndependent,undefined)
 for (const flag of ['true',1,{},[]]) assert.throws(()=>validateRoutingDecision({...create,historyIndependent:flag},request),RouterFailure)
 assert.throws(()=>validateRoutingDecision({...decision,historyIndependent:true},request),RouterFailure)
 assert.equal(routingPayload(request).historyIncomplete,true)
 assert.equal(routingPayload(input).historyIncomplete,false)
})
test('a new topic names only an offered project folder; running work and folders reach the prompt only when present',()=>{
 const projects=[{id:'p1',name:'invoice-app'}]
 const create={action:'CREATE',contextId:null,title:'发票导出',question:null,reason:'新事项',historyIndependent:true}
 assert.equal(validateRoutingDecision({...create,projectId:'p1'},{...input,projects}).projectId,'p1')
 assert.equal(validateRoutingDecision({...create,projectId:'p9'},{...input,projects}).projectId,undefined)
 assert.equal(validateRoutingDecision({...create,projectId:'p1'},input).projectId,undefined)
 assert.equal(validateRoutingDecision({...decision,projectId:'p1'},{...input,projects}).projectId,undefined)
 const plain=routingPayload(input)
 assert.ok(!('projects' in plain) && !('running' in plain))
 const full=routingPayload({...input,projects,running:{topicId:'topic',request:'整理表格',progress:'x'.repeat(2000)}})
 assert.deepEqual(full.projects,projects)
 assert.equal(full.running?.progress.length,600)
 // A running topic that is not among the candidates is left out rather than trusted.
 assert.ok(!('running' in routingPayload({...input,running:{topicId:'missing',request:'',progress:''}})))
})

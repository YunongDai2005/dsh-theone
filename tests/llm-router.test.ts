import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {SessionId} from '@deepseek-ai/dsh-session'
import {DeepSeekRouter,RouterFailure,validateRoutingDecision,routingPayload} from '../src/llm-router.ts'
import {harness,ask} from './harness.ts'
const catalog=[{id:'topic',title:'研究',summary:'研究工作',entities:['研究'],keywords:[],lastState:'进行中'},
 {id:'other',title:'购物',summary:'购物清单',entities:['购物'],keywords:[],lastState:'进行中'}]
const input={text:'继续',contexts:catalog,currentId:'topic'}
const decision={action:'EXISTING',contextId:'topic',title:null,question:null,reason:'继续当前工作'}
function response(value:unknown,finish='stop') {
 return new Response(JSON.stringify({model:'deepseek-flash',choices:[{finish_reason:finish,message:{content:JSON.stringify(value)}}],usage:{prompt_tokens:20,completion_tokens:10,total_tokens:30}}),{headers:{'Content-Type':'application/json'}})
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
 let calls=0
 const client=new DeepSeekRouter({apiKey:'test-only-key'},async(_url,init)=>{
  calls++
  const body=JSON.parse(String(init?.body))
  assert.equal(body.model,'deepseek-flash')
  assert.equal(body.thinking.type,'disabled')
  assert.equal(body.tools,undefined)
  assert.equal(body.messages.length,2)
  assert.ok(!body.messages[1].content.includes('sk-testsecret0123456789012345'))
  assert.ok(!body.messages[1].content.includes('private@example.com'))
  assert.ok(!body.messages[1].content.includes('192.168.1.20'))
  return response(decision)
 })
 const result=await client.decide({...input,text:'继续 sk-testsecret0123456789012345',recent:[{role:'assistant',text:'联系 private@example.com 192.168.1.20'}]})
 assert.equal(result.decision.action,'KEEP');assert.equal(result.usage?.total_tokens,30);assert.equal(calls,1)
 assert.throws(()=>routingPayload({...input,text:'   '}),RouterFailure)
})
test('failed or truncated API output is not an executable route',async()=>{
 const truncated=new DeepSeekRouter({apiKey:'test'},async()=>response(decision,'length'))
 await assert.rejects(truncated.decide(input),error=>error instanceof RouterFailure && error.code==='ROUTER_RESPONSE_INCOMPLETE')
 const failed=new DeepSeekRouter({apiKey:'test'},async()=>new Response('private upstream text',{status:401}))
 await assert.rejects(failed.decide(input),error=>error instanceof RouterFailure && error.message==='ROUTER_HTTP_ERROR' && error.meta?.httpStatus===401)
})
test('unavailable routes cool down, probe again, and reset after success',async()=>{
 let time=1000,calls=0,status=403
 const client=new DeepSeekRouter({apiKey:'test'},async()=>{
  calls++;return status===200?response(decision):new Response('{}',{status})
 },()=>time)
 await assert.rejects(client.decide(input),error=>error instanceof RouterFailure && error.meta?.httpStatus===403)
 await assert.rejects(client.decide(input),error=>error instanceof RouterFailure && error.code==='ROUTER_CIRCUIT_OPEN' && error.meta?.retryAfterMs===60000)
 assert.equal(calls,1)
 time+=60000;status=200
 assert.equal((await client.decide(input)).decision.action,'KEEP')
 status=500
 for(let i=0;i<3;i++)await assert.rejects(client.decide(input),RouterFailure)
 await assert.rejects(client.decide(input),error=>error instanceof RouterFailure && error.code==='ROUTER_CIRCUIT_OPEN')
 assert.equal(calls,5)
})
test('caller cancellation does not mark the model unavailable',async()=>{
 let calls=0
 const controller=new AbortController()
 const client=new DeepSeekRouter({apiKey:'test'},async()=>{
  calls++
  if(calls===1){controller.abort();throw controller.signal.reason}
  return response(decision)
 })
 await assert.rejects(client.decide(input,controller.signal))
 assert.equal((await client.decide(input)).decision.action,'KEEP')
 assert.equal(calls,2)
})

test('rebuilt Gateway recovers recent DSH references without copying chat into the routing database',async()=>{
 const root=await mkdtemp(join(tmpdir(),'theone-router-recovery-'))
 const previousFetch=globalThis.fetch,previousKey=process.env.THEONE_ROUTER_API_KEY
 process.env.THEONE_ROUTER_API_KEY='test-only'
 const payloads:ReturnType<typeof routingPayload>[]=[]
 globalThis.fetch=async(_url,init)=>{
  const body=JSON.parse(String(init?.body));payloads.push(JSON.parse(body.messages[1].content))
  return response({...decision,contextId:'ctx_qwen_9070xt'})
 }
 let app=await harness(root,undefined,{routerMode:'llm'})
 try{
  await ask(app.gateway,'Qwen 需要检查 ROCm 配置')
  const old=app.gateway.id
  await app.close();app=await harness(root,undefined,{routerMode:'llm'})
  assert.deepEqual(app.ctx.theone.store.recentGatewayIds('another-entry',app.gateway.id),[])
  assert.deepEqual(app.ctx.theone.store.recentGatewayIds('test-gateway',app.gateway.id),[old])
  const result=await ask(app.gateway,'继续刚才的配置检查')
  assert.equal(result.end?.data.reason.kind,'completed')
  assert.ok(payloads.at(-1)!.recent?.some(message=>message.role==='user' && message.text==='Qwen 需要检查 ROCm 配置'))
  assert.ok(payloads.at(-1)!.recent?.some(message=>message.role==='assistant' && message.text.includes('ctx_qwen_9070xt')))
  assert.equal(app.ctx.theone.store.route(result.input.id)?.decision.action,'KEEP')
 }finally{
  await app.close();globalThis.fetch=previousFetch
  if(previousKey===undefined)delete process.env.THEONE_ROUTER_API_KEY;else process.env.THEONE_ROUTER_API_KEY=previousKey
  await rm(root,{recursive:true,force:true})
 }
})
test('gateway reserves admission during LLM classification; cancellation and invalid output preserve state', {timeout:30000},async()=>{
 const root=await mkdtemp(join(tmpdir(),'theone-llm-'))
 const previousFetch=globalThis.fetch,previousKey=process.env.THEONE_ROUTER_API_KEY
 const entered=Promise.withResolvers<void>()
 let behavior:'pending'|'invalid'|'valid'='pending'
 globalThis.fetch=async(_url,init)=>{
  if(behavior==='pending') {
   entered.resolve()
   await new Promise<void>(resolve=>{
    if(init?.signal?.aborted)resolve();else init?.signal?.addEventListener('abort',()=>resolve(),{once:true})
   })
   init?.signal?.throwIfAborted()
  }
  return response({action:'EXISTING',contextId:behavior==='invalid'?'unknown':'ctx_qwen_9070xt',title:null,question:null,reason:'测试路由'})
 }
 process.env.THEONE_ROUTER_API_KEY='test-only-no-network'
 const app=await harness(root,undefined,{routerMode:'llm'})
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
  behavior='invalid'
  const invalid=await ask(app.gateway,'Qwen')
  assert.equal(app.ctx.theone.store.route(invalid.input.id)?.decision.action,'CLARIFY')
  assert.equal(app.ctx.theone.store.current('test-gateway'),undefined)
  assert.equal(app.model.requests.length,0)
  const invalidNotice=invalid.events.find(event=>event.type==='user/message' && event.data.source.kind==='theone-route')
  assert.ok(invalidNotice?.type==='user/message' && invalidNotice.data.source.kind==='theone-route')
  assert.equal(invalidNotice.data.source.router?.errorCode,'ROUTER_INVALID_DECISION')
  behavior='valid'
  const valid=await ask(app.gateway,'Qwen')
  assert.equal(valid.output,'模拟回答：ctx_qwen_9070xt')
  const notice=valid.events.find(event=>event.type==='user/message' && event.data.source.kind==='theone-route')
  assert.ok(notice?.type==='user/message' && notice.data.source.kind==='theone-route')
  assert.equal(notice.data.source.router?.model,'deepseek-flash')
  assert.equal(notice.data.source.router?.promptTokens,20)
 }finally{
  await app.close();globalThis.fetch=previousFetch
  if(previousKey===undefined)delete process.env.THEONE_ROUTER_API_KEY;else process.env.THEONE_ROUTER_API_KEY=previousKey
  await rm(root,{recursive:true,force:true})
 }
})

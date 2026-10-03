import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { referencesHistory } from '../src/routing-policy.ts'
import { resolveContext } from '../src/router.ts'
import { validateRoutingDecision, ROUTING_PROMPT, RouterFailure } from '../src/llm-router.ts'
import { harness, textResponse, ask } from './harness.ts'

const contexts = [
  { id:'plugin', title:'TheOne 插件', summary:'开发聊天路由', entities:['TheOne'], keywords:['聊天'], lastState:'测试' },
  { id:'box', title:'AI Box', summary:'硬件维护', entities:['AI Box'], keywords:['配置'], lastState:'维护' },
]
const clarify = { action:'CLARIFY', contextId:null, title:null,
  question:'你问的是之前提到过的余俊豪吗？请补充他的相关信息或确认具体指谁。',
  reason:'目录无相关话题，人物背景信息缺失，无法确定指代。' }

test('unfamiliar facts and names start topics even when the model invents a clarification', () => {
  for (const text of ['余俊豪是安徽人吗？','华为是什么','富士山现在什么天气','昨天发生了哪些新闻？',
    '帮我介绍一下林晓宇','Alex Smith 是哪里人','Is Jordan Lee from California?',
    'What happened yesterday?', '帮我写一封邮件，再列一个购物清单']) {
    assert.equal(referencesHistory(text),false,text)
    const input = {text,contexts,currentId:'plugin',historyIncomplete:true}
    const decision = validateRoutingDecision(clarify,input)
    assert.equal(decision.action,'CREATE',text)
    assert.equal(decision.historyIndependent,true,text)
    assert.equal(decision.question,undefined,text)
    const created = validateRoutingDecision({action:'CREATE',contextId:null,title:'新事项',question:null,
      reason:'没有匹配',historyIndependent:false},input)
    assert.equal(created.historyIndependent,true,text)
  }
  assert.equal(resolveContext('余俊豪是安徽人吗？', contexts, 'plugin').action,'CREATE')
})

test('missing historical references and genuine competing contexts still allow clarification', () => {
  for (const text of ['继续上次那个','用之前的链接下载','那个模型不行','继续昨天那个','你还记得我们聊的方案吗',
    'Use the previous link', 'Resume our previous conversation', 'continue', 'Do you remember when we discussed that?']) {
    assert.equal(referencesHistory(text),true,text)
    assert.equal(validateRoutingDecision(clarify,{text,contexts}).action,'CLARIFY',text)
  }
  const input = {text:'把这两个项目的配置一起改一下',contexts}
  assert.equal(validateRoutingDecision({...clarify,candidateIds:['plugin','box']},input).action,'CLARIFY')
  assert.equal(validateRoutingDecision({...clarify,candidateIds:['plugin','plugin']},input).action,'CREATE')
  assert.throws(()=>validateRoutingDecision({...clarify,candidateIds:['plugin','invented']},input),RouterFailure)
  assert.throws(()=>validateRoutingDecision({...clarify,candidateIds:'plugin,box'},input),RouterFailure)
  // Known-topic selection remains semantic; the policy does not force CREATE.
  assert.equal(validateRoutingDecision({action:'EXISTING',contextId:'box',title:null,question:null,reason:'明确设备'},
    {text:'AI Box 配置修好了没有',contexts,currentId:'plugin'}).action,'SWAP')
})

test('new-topic fallback avoids colliding titles and ignores recent assistant speculation', () => {
  const text = '余俊豪是安徽人吗？'
  const input = {text,contexts:[{...contexts[0],title:text}],currentId:'plugin',
    recent:[{role:'assistant' as const,text:'你是说之前提到的余俊豪吗？'}]}
  const decision = validateRoutingDecision(clarify,input)
  assert.equal(decision.action,'CREATE')
  assert.notEqual(decision.title,text)
  const sensitive = validateRoutingDecision(clarify,{text:'帮我配置 api_key=syntheticsecret123456 sk-syntheticprivate1234567890',contexts})
  assert.doesNotMatch(sensitive.title!,/syntheticsecret|syntheticprivate/)
})

test('native gateway dispatches unsupported clarification as CREATE during partial indexing and search failure', {timeout:30000}, async () => {
  const root = await mkdtemp(join(tmpdir(),'theone-less-clarification-'))
  const app = await harness(root,undefined,{routerMode:'llm',historyCatalog:true})
  try {
    app.ctx.theone.store.seed(Array.from({length:70},(_,i)=>({...contexts[0],id:`unrelated-${i}`,title:`无关项目 ${i}`})))
    app.ctx.theone.catalog!.candidates = async () => app.ctx.theone.store.contexts().slice(0,16)
    app.model.behavior = async function* (options) {
      yield* textResponse(options.system === ROUTING_PROMPT ? JSON.stringify(clarify) : '由聊天模型正常处理新问题')
    }
    const first = await ask(app.gateway,'余俊豪是安徽人吗？')
    assert.equal(first.output,'由聊天模型正常处理新问题')
    assert.equal(app.ctx.theone.store.route(first.input.id)?.decision.action,'CREATE')
    assert.equal(app.ctx.theone.store.route(first.input.id)?.status,'completed')
    assert.ok(!first.output.includes('之前提到'))
    app.ctx.theone.catalog!.candidates = async () => {throw new Error('synthetic failure')}
    const second = await ask(app.gateway,'Is Jordan Lee from California?')
    assert.equal(second.output,'由聊天模型正常处理新问题')
    assert.equal(app.ctx.theone.store.route(second.input.id)?.decision.action,'CREATE')
    const count = app.model.requests.length
    const unresolved = await ask(app.gateway,'用之前的链接下载')
    assert.equal(app.ctx.theone.store.route(unresolved.input.id)?.decision.action,'CLARIFY')
    assert.equal(app.model.requests.length,count)
  } finally {await app.close();await rm(root,{recursive:true,force:true})}
})

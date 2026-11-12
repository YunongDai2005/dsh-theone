// Independent security regression checks. All model and PayPal responses are synthetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { StudioWorkflow } from './studio.mjs';
import { createStudioApp } from './studio-server.mjs';
import { makePassword } from './studio-auth.mjs';
import { previewPlanner, previewPayPal } from './preview.mjs';

const topics = [
  { id:'design', title:'Design client', summary:'Website design services.', recipient:'design@example.invalid' },
  { id:'move', title:'Moving project', summary:'Moving logistics services.', recipient:'move@example.invalid' },
];
const password = 'test-only-passphrase-4381';
const members = [
  { id:'alex', name:'Alex', role:'finance', project_ids:['design','move'] },
  { id:'mia', name:'Mia', role:'member', project_ids:['design'] },
  { id:'olivia', name:'Olivia', role:'member', project_ids:['design'] },
  { id:'leo', name:'Leo', role:'member', project_ids:['move'] },
].map(m => ({...m,...makePassword(password)}));

function options() {
  const databaseDirectory=mkdtempSync(join(tmpdir(),'theone-studio-review-'));
  const calls=[],routes=[], paypal=previewPayPal();
  for (const name of ['createDraft','getDraft','getInvoice','updateDraft','deleteDraft','publishInvoice','findDraftByInvoiceNumber']) {
    const original=paypal[name].bind(paypal);
    paypal[name]=async(...args)=>{calls.push(name);return original(...args);};
  }
  const planner={
    async route(message,catalog,context){
      routes.push({message,catalog:structuredClone(catalog),context:structuredClone({...context,onCall:undefined})});
      const result=await previewPlanner.route(message,catalog,context),ids=new Set(catalog.map(t=>t.id));
      if(result.decision.candidateIds)result.decision.candidateIds=result.decision.candidateIds.filter(id=>ids.has(id));
      if(result.decision.relatedIds)result.decision.relatedIds=result.decision.relatedIds.filter(id=>ids.has(id));
      return result;
    },
    plan:previewPlanner.plan.bind(previewPlanner),
  };
  return {members,topics,planner,paypal,databaseDirectory,studio:{id:'test-studio',name:'Test studio'},calls,routes};
}
async function fixture(run) {
  const config=options(),app=new StudioWorkflow(config);
  try {await run(app,config);} finally {app.close();rmSync(config.databaseDirectory,{recursive:true,force:true});}
}
const denied=operation=>assert.rejects(async()=>await operation(),error=>[401,403,404].includes(error.status));
const draft=(app,actor,amount,project='design',requestId)=>app.plan(actor,`Draft a ${amount} EUR invoice for the ${project==='design'?'design client':'moving project'} for ${project==='design'?'website assets':'moving services'}.`,requestId);
const amount=p=>p.payload.items[0].unit_amount.value;

test('studio: project boundaries hold across ledger, messages, review, history and brief',async()=>fixture(async(app,{calls})=>{
  const design=(await draft(app,'mia','480')).proposal;
  const move=(await draft(app,'leo','72','move')).proposal;
  const mia=app.state('mia'), leo=app.state('leo');
  assert.deepEqual(mia.topics.map(t=>t.id),['design']);
  assert.deepEqual(leo.topics.map(t=>t.id),['move']);
  assert.equal(mia.proposals.length,1);assert.equal(leo.proposals.length,1);
  assert.equal(mia.proposals[0].owner_id,'mia');assert.equal(leo.proposals[0].owner_id,'leo');
  assert.ok(!JSON.stringify(mia).includes(move.id));
  assert.ok(!JSON.stringify(leo).includes(design.id));
  await denied(()=>app.review('leo',design.id));
  await denied(()=>app.history('leo',design.id));
  await denied(()=>app.brief('leo','design'));
  await denied(()=>app.revise('leo',design.id,1,{amount:'600'}));
  await denied(()=>app.discard('leo',design.id,1));
  await denied(()=>app.approve('leo',design.id,design.digest));
  await denied(()=>app.reconcile('leo',design.id));
  await denied(()=>app.refreshRemote('leo',design.id));
  assert.equal(calls.length,0);
}));

test('studio: same-project collaborators can read but cannot edit or approve another owner',async()=>fixture(async(app,{calls})=>{
  const proposal=(await draft(app,'mia','480')).proposal;
  const shared=app.state('olivia').proposals.find(p=>p.id===proposal.id);
  assert.ok(shared);assert.equal(shared.owner_id,'mia');
  assert.equal(shared.permissions.edit,false);assert.equal(shared.permissions.approve,false);
  assert.equal(app.review('olivia',proposal.id).id,proposal.id);
  await denied(()=>app.revise('olivia',proposal.id,1,{amount:'999'}));
  await denied(()=>app.correct('olivia',proposal.id,1,'design'));
  await denied(()=>app.discard('olivia',proposal.id,1));
  await denied(()=>app.approve('olivia',proposal.id,proposal.digest));
  await denied(()=>app.reviewRemote('olivia',proposal.id,1,'update',{amount:'999'}));
  assert.equal(amount(app.state('mia').proposals[0]),'480.00');
  assert.equal(calls.length,0);
}));

test('studio: finance can review a member draft, stale approval fails, replay creates only once',async()=>fixture(async(app,{calls})=>{
  const proposal=(await draft(app,'mia','480')).proposal;
  const original=app.review('alex',proposal.id);
  const updated=app.revise('mia',proposal.id,1,{amount:'520'});
  await assert.rejects(async()=>app.approve('alex',proposal.id,original.digest));
  assert.equal(calls.length,0);
  const review=app.review('alex',proposal.id);
  const created=await app.approve('alex',proposal.id,review.digest);
  assert.equal(created.state,'CREATED');
  assert.equal(amount(created),'520.00');assert.equal(updated.revision,2);
  const callCount=calls.length;
  const replay=await app.approve('alex',proposal.id,review.digest);
  assert.equal(replay.remote_id,created.remote_id);assert.equal(calls.length,callCount);
  assert.equal(calls.filter(c=>c==='createDraft').length,1);
  await denied(()=>app.approve('mia',proposal.id,review.digest));
}));

test('studio: project correction cannot place an owner invoice into an unauthorized project',async()=>fixture(async(app,{calls})=>{
  const proposal=(await draft(app,'mia','480')).proposal;
  await denied(()=>app.correct('mia',proposal.id,1,'move'));
  await denied(()=>app.correct('alex',proposal.id,1,'move'));
  assert.equal(app.state('mia').proposals[0].topic_id,'design');
  assert.equal(calls.length,0);
}));

test('studio: request-id replay and model context stay isolated between members',async()=>fixture(async(app,{routes})=>{
  const a=(await draft(app,'mia','480','design','same-client-request')).proposal;
  const b=(await draft(app,'leo','72','move','same-client-request')).proposal;
  assert.notEqual(a.id,b.id);
  const replay=(await draft(app,'mia','480','design','same-client-request')).proposal;
  assert.equal(replay.id,a.id);
  const miaRoute=routes.find(r=>r.message.includes('480'));
  const leoRoute=routes.find(r=>r.message.includes('72'));
  assert.deepEqual(miaRoute.catalog.map(t=>t.id),['design']);
  assert.deepEqual(leoRoute.catalog.map(t=>t.id),['move']);
  assert.equal(JSON.stringify(leoRoute.context).includes('480'),false);
  assert.equal(JSON.stringify(miaRoute.context).includes('72'),false);
}));

test('studio: teammate invoice references cannot silently edit the caller own draft',async()=>fixture(async(app,{calls})=>{
  const own=(await draft(app,'mia','480')).proposal;
  const other=(await draft(app,'olivia','120')).proposal;
  try {await app.plan('mia',`Change invoice ${other.payload.detail.invoice_number} for the design client to 550 EUR.`);}
  catch(error){assert.ok([400,403,404,409,422].includes(error.status),error.message);}
  const ledger=app.state('mia').proposals;
  assert.equal(amount(ledger.find(p=>p.id===own.id)),'480.00');
  assert.equal(amount(ledger.find(p=>p.id===other.id)),'120.00');
  assert.equal(calls.length,0);
}));

test('studio: a pending client question belongs only to its author',async()=>fixture(async(app,{routes})=>{
  const question=await app.plan('mia','Draft a 480 EUR invoice for that client for website assets.');
  assert.equal(question.plan.intent,'clarify');
  await app.plan('leo','The moving project.');
  const leoRoute=routes.at(-1);
  assert.equal(leoRoute.context.pendingQuestion,null);
  assert.equal(app.state('leo').proposals.length,0);
  const resolved=await app.plan('mia','The design client.');
  assert.equal(resolved.proposal.topic_id,'design');assert.equal(amount(resolved.proposal),'480.00');
  assert.equal(app.state('leo').proposals.length,0);
}));

test('studio: an explicit unauthorized project is refused before inference',async()=>fixture(async(app,{routes,calls})=>{
  await denied(()=>draft(app,'mia','72','move'));
  assert.equal(routes.length,0);assert.equal(calls.length,0);
  assert.equal(app.state('mia').proposals.length,0);
}));

test('studio: persisted owner attribution and project permissions survive restart',async()=>{
  const config=options();let app=new StudioWorkflow(config);
  try {
    const proposal=(await draft(app,'mia','480')).proposal;
    app.close();app=new StudioWorkflow(config);
    const row=app.state('alex').proposals.find(p=>p.id===proposal.id);
    assert.equal(row.owner_id,'mia');assert.equal(row.owner_name,'Mia');
    assert.equal(app.state('leo').proposals.length,0);
    await denied(()=>app.revise('olivia',proposal.id,1,{amount:'1'}));
  }finally{app.close();rmSync(config.databaseDirectory,{recursive:true,force:true});}
});

test('studio: group status replies and persisted messages use the authorized team ledger',async()=>fixture(async(app)=>{
  await draft(app,'mia','480');await draft(app,'olivia','120');await draft(app,'leo','72','move');
  const brief=app.brief('mia','design');
  assert.equal(brief.awaiting_review.count,2);assert.deepEqual(brief.awaiting_review.totals,[{currency:'EUR',amount:'600.00'}]);
  const result=await app.plan('mia','What is the invoice status for the design client?','group-status-query');
  assert.equal(result.plan.intent,'invoice_status');assert.match(result.plan.reply,/Awaiting review: 2 \(600\.00 EUR\)/);
  const reply=app.state('mia').messages.filter(m=>m.owner_id==='mia'&&m.role==='assistant').at(-1);
  assert.equal(reply.text,result.plan.reply);
  assert.ok(!result.plan.reply.includes('72.00'));
}));

test('studio: a shared message cannot disclose a teammate private routing metadata',async()=>{
  const config=options(),capturedPlans=[];
  config.planner={
    async route(){return {model:'synthetic-metadata-test',decision:{action:'EXISTING',contextId:'move',relatedIds:[],reason:'private-design-route-evidence'},trace:{private_reason:'private-design-trace-evidence',candidateIds:['design'],calls:[]}};},
    async plan(message,catalog,context){capturedPlans.push(context);return {model:'synthetic-metadata-test',plan:{intent:'chat',topic_id:'move',amount:null,currency:null,description:null,reply:'Moving project note recorded.'}};},
  };
  const app=new StudioWorkflow(config);
  try {
    await app.plan('alex','Moving project delivery note.');
    const leo=app.state('leo'),alex=app.state('alex');
    assert.equal(leo.messages.length,2);
    assert.ok(JSON.stringify(alex.messages).includes('private-design-trace-evidence'));
    assert.ok(!JSON.stringify(leo).includes('private-design'));
    assert.deepEqual(capturedPlans[0].references,[]);
    assert.deepEqual(leo.messages[0].route.relatedIds??[],[]);
  }finally{app.close();rmSync(config.databaseDirectory,{recursive:true,force:true});}
});

test('studio: moving an invoice does not reveal inaccessible project history to new readers',async()=>fixture(async(app)=>{
  const original=(await draft(app,'alex','480')).proposal;
  app.correct('alex',original.id,1,'move');
  const current=app.state('leo').proposals.find(p=>p.id===original.id);
  assert.ok(current);assert.equal(current.topic_id,'move');
  const history=app.history('leo',original.id),review=app.review('leo',original.id);
  assert.ok(history.versions.every(v=>v.fields.project==='move'));
  assert.ok(!JSON.stringify({history,review}).includes('design@example.invalid'));
  assert.ok(!JSON.stringify(app.state('leo').messages).includes('for the design client'));
  assert.ok(app.state('leo').studio_events.filter(event=>event.proposal_id===original.id).every(event=>event.revision>=2));
  assert.equal(app.history('alex',original.id).versions.length,2);
}));

async function httpFixture(run) {
  const config=options(),server=createStudioApp({...config,preview:true});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  try {await run(base,config);} finally {server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));rmSync(config.databaseDirectory,{recursive:true,force:true});}
}
function client(base) {
  let cookie='',csrf='';
  return {
    get cookie(){return cookie;},get csrf(){return csrf;},
    async request(path,{method='GET',body,headers={},useToken=true,useCookie=true}={}) {
      const response=await fetch(base+path,{method,headers:{...(useCookie&&cookie?{Cookie:cookie}:{}),...(useToken&&csrf?{'X-TheOne-Token':csrf}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{}),...headers},...(body!==undefined?{body:JSON.stringify(body)}:{})});
      const setCookie=response.headers.get('set-cookie');if(setCookie)cookie=setCookie.split(';')[0];
      const data=await response.json();if(data.csrf)csrf=data.csrf;
      return {response,data,setCookie};
    },
    async login(name){await this.request('/session');return this.request('/login',{method:'POST',body:{name,password}});}
  };
}

test('studio HTTP: opaque HttpOnly sessions rotate at login and invalidate at logout',async()=>httpFixture(async(base)=>{
  const person=client(base),anonymous=await person.request('/session');
  assert.equal(anonymous.data.actor,null);
  assert.match(anonymous.setCookie,/HttpOnly/i);assert.match(anonymous.setCookie,/SameSite=Strict/i);
  const oldCookie=person.cookie,oldCsrf=person.csrf;
  const login=await person.request('/login',{method:'POST',body:{name:'Mia',password}});
  assert.equal(login.response.status,200);assert.notEqual(person.cookie,oldCookie);assert.notEqual(person.csrf,oldCsrf);
  const stale=await fetch(base+'/state',{headers:{Cookie:oldCookie,'X-TheOne-Token':oldCsrf}});
  assert.notEqual(stale.status,200);
  const state=await person.request('/state');assert.equal(state.response.status,200);
  assert.equal(state.data.actor.id,'mia');
  assert.ok(!JSON.stringify(state.data).includes('password_hash'));assert.ok(!JSON.stringify(state.data).includes(password));
  const activeCookie=person.cookie,activeCsrf=person.csrf;
  const logout=await person.request('/logout',{method:'POST',body:{}});assert.equal(logout.response.status,200);
  const invalid=await fetch(base+'/state',{headers:{Cookie:activeCookie,'X-TheOne-Token':activeCsrf}});
  assert.notEqual(invalid.status,200);
}));

test('studio HTTP: actor fields cannot forge ownership or financial permission',async()=>httpFixture(async(base,{calls})=>{
  const mia=client(base);assert.equal((await mia.login('Mia')).response.status,200);
  const plan=await mia.request('/plan',{method:'POST',body:{message:'Draft a 480 EUR invoice for the design client for website assets.',request_id:'http-actor-forgery',actor_id:'alex',owner_id:'alex',role:'finance'}});
  assert.equal(plan.response.status,400);assert.equal(calls.length,0);
  const valid=await mia.request('/plan',{method:'POST',body:{message:'Draft a 480 EUR invoice for the design client for website assets.',request_id:'http-valid-request'}});
  assert.equal(valid.response.status,200);
  const row=(await mia.request('/state')).data.proposals[0];
  assert.equal(row.owner_id,'mia');assert.equal(row.permissions.approve,false);
  const rejected=await mia.request('/approve',{method:'POST',body:{id:row.id,digest:row.digest,actor_id:'alex',role:'finance'}});
  assert.equal(rejected.response.status,400);
  const direct=await mia.request('/approve',{method:'POST',body:{id:row.id,digest:row.digest}});
  assert.equal(direct.response.status,403);assert.equal(calls.length,0);
}));

test('studio HTTP: CSRF, Origin and Host protections precede all provider activity',async()=>httpFixture(async(base,{calls,routes})=>{
  const mia=client(base);await mia.login('Mia');
  const body={message:'Draft a 480 EUR invoice for the design client for website assets.'};
  for (const request of [
    {useToken:false},
    {headers:{'X-TheOne-Token':'forged'}},
    {headers:{Origin:'https://attacker.example'}},
  ]) {
    const result=await mia.request('/plan',{method:'POST',body,...request});
    assert.equal(result.response.status,403,JSON.stringify(request));
  }
  const foreignHost=await new Promise((resolve,reject)=>{
    const url=new URL(base),req=httpRequest({hostname:url.hostname,port:url.port,path:'/plan',method:'POST',headers:{Host:'attacker.example',Cookie:mia.cookie,'X-TheOne-Token':mia.csrf,'Content-Type':'application/json'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});
    req.on('error',reject);req.end(JSON.stringify(body));
  });
  assert.equal(foreignHost,403);
  assert.equal(routes.length,0);assert.equal(calls.length,0);
}));

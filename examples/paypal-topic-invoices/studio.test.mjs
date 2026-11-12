import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StudioWorkflow } from './studio.mjs';
import { StudioAuth, makePassword } from './studio-auth.mjs';
import { studioPreviewPlanner, studioTopics } from './studio-server.mjs';
import { previewTopics, previewPayPal } from './preview.mjs';

const members=[
  {id:'alex',name:'Alex',role:'finance',project_ids:['design','move','budget']},
  {id:'mia',name:'Mia',role:'member',project_ids:['design','budget']},
  {id:'leo',name:'Leo',role:'member',project_ids:['move','budget']},
];
const make = extra => new StudioWorkflow({members,topics:previewTopics,planner:studioPreviewPlanner,paypal:previewPayPal(),...extra});

test('studio lifecycle: finance edits and deletes a member Sandbox draft with actor receipts',async()=>{
  const paypal=previewPayPal(),calls=[];
  for(const method of ['createDraft','getDraft','getInvoice','updateDraft','deleteDraft']){
    const original=paypal[method].bind(paypal);paypal[method]=async(...args)=>{calls.push(method);return original(...args);};
  }
  const app=make({paypal});
  try{
    const draft=(await app.plan('mia','Draft a 480 EUR invoice for the design client for website assets.')).proposal;
    const created=await app.approve('alex',draft.id,draft.digest);
    const review=app.reviewRemote('alex',draft.id,1,'update',{amount:'520'});
    const updated=await app.applyRemote('alex',draft.id,1,'update',{amount:'520'},review.digest);
    assert.equal(updated.payload.items[0].unit_amount.value,'520.00');
    assert.equal(updated.owner_id,'mia');assert.equal(updated.revision,2);
    assert.equal(calls.filter(c=>c==='createDraft').length,1);
    assert.equal(calls.filter(c=>c==='updateDraft').length,1);
    const before=calls.length;
    await assert.rejects(()=>app.refreshRemote('mia',draft.id),e=>e.status===403);
    assert.equal(calls.length,before);
    const deletion=app.reviewRemote('alex',draft.id,2,'delete');
    const deleted=await app.applyRemote('alex',draft.id,2,'delete',undefined,deletion.digest);
    assert.equal(deleted.state,'DELETED');
    assert.equal(await paypal.getInvoice(created.remote_id),null);
    const receipts=app.history('mia',draft.id).studio_events;
    assert.ok(receipts.some(e=>e.action==='approve'&&e.actor_id==='alex'&&e.owner_id==='mia'&&e.outcome==='succeeded'));
    assert.ok(receipts.some(e=>e.action==='remote_update'&&e.actor_name==='Alex'&&e.revision===2&&e.outcome==='succeeded'));
    assert.ok(receipts.some(e=>e.action==='remote_delete'&&e.actor_id==='alex'&&e.owner_id==='mia'&&e.outcome==='succeeded'));
  }finally{app.close();}
});

test('studio preview: single-project member clarification uses only their permitted catalog',async()=>{
  const app=make();
  try{
    const question=await app.plan('mia','Draft a 480 EUR invoice for that client for website assets.');
    assert.equal(question.plan.intent,'clarify');
    assert.deepEqual(question.route.candidateIds,['design']);
    assert.ok(!question.plan.reply.includes('Moving'));
    const result=await app.plan('mia','The design client.');
    assert.equal(result.proposal.owner_id,'mia');
    assert.equal(result.proposal.topic_id,'design');
    assert.equal(result.proposal.payload.items[0].unit_amount.value,'480.00');
    assert.equal(app.state('leo').proposals.length,0);
  }finally{app.close();}
});

test('studio preview: the Studio expenses title routes notes without creating an invoice',async()=>{
  const app=make({topics:studioTopics});
  try{
    const result=await app.plan('mia','Record 72 EUR of moving expenses in Studio expenses. Do not create an invoice.');
    assert.equal(result.route.topicId,'budget');assert.equal(result.plan.intent,'chat');
    assert.equal(result.proposal,null);
    assert.equal(app.state('mia').topics.find(t=>t.id==='budget').title,'Studio expenses');
    assert.equal(app.state('mia').proposals.length,0);
    assert.ok(!result.route.reason.includes('household'));
  }finally{app.close();}
});

test('studio persistence: membership changes fail closed instead of reusing old personal contexts',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'theone-studio-acl-'));
  let app;
  try{
    app=make({databaseDirectory:directory});
    const proposal=(await app.plan('mia','Draft a 480 EUR invoice for the design client for website assets.')).proposal;
    app.close();app=null;
    assert.throws(()=>make({databaseDirectory:directory,members:members.map(m=>m.id==='mia'?{...m,project_ids:['move','budget']}:m)}),/memberships changed/);
    app=make({databaseDirectory:directory});
    assert.equal(app.state('mia').proposals[0].id,proposal.id);
    assert.equal(app.state('leo').proposals.length,0);
  }finally{app?.close();rmSync(directory,{recursive:true,force:true});}
});

test('studio auth: repeated invalid passwords are bounded and cannot manufacture a session role',()=>{
  const password='test-only-studio-password',auth=new StudioAuth([{...members[0],...makePassword(password)}]);
  const headers={},res={setHeader(k,v){headers[k]=v;}},req={headers:{},socket:{remoteAddress:'127.0.0.1'}};
  const session=auth.session(req,res);
  try{
    for(let n=0;n<8;n++)assert.throws(()=>auth.login(req,res,session,{name:'Alex',password:'incorrect-password',role:'admin'}),e=>e.status===401);
    assert.throws(()=>auth.login(req,res,session,{name:'Alex',password}),e=>e.status===429);
    assert.equal(session.actorId,null);
    assert.match(headers['Set-Cookie'],/HttpOnly; SameSite=Strict/);
  }finally{auth.close();}
});

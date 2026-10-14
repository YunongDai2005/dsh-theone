import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {createHmac} from 'node:crypto';
import {connect, Memory} from '../memory.mjs';
import {validatePlan} from '../agent.mjs';
import {createApp} from '../server.mjs';
let db, m, other, launch, travel, unrelated, fact, server;
before(async()=>{db=await connect();m=new Memory(db,'theone_'+randomBytes(20).toString('hex'));other=new Memory(db,'theone_'+randomBytes(20).toString('hex'));await m.init();await other.init();launch=await m.createTopic('Launch');travel=await m.createTopic('Travel');unrelated=await m.createTopic('Reading');});
after(async()=>{if(server)await new Promise(r=>server.close(r));await m.graph.delete();await other.graph.delete();await db.close();});
test('confirmed memory and source come from actual FalkorDB',async()=>{fact=await m.remember(launch.id,'venue','Studio North','Synthetic venue booking');const c=await m.context(launch.id);assert.equal(c[0].value,'Studio North');assert.equal(c[0].evidence,'Synthetic venue booking');assert.equal(c[0].revision,1);});
test('unconnected topics and another workspace receive no context',async()=>{assert.deepEqual(await m.context(travel.id),[]);await assert.rejects(other.context(launch.id),{status:404});});
test('parameterized adversarial title/value cannot inject graph operations',async()=>{const title="x'}) MATCH (n) DETACH DELETE n //";const t=await m.createTopic(title);assert.equal(t.title,title);assert.equal((await m.context(launch.id))[0].value,'Studio North');});
test('explicit sharing gives only the selected fact',async()=>{await m.remember(launch.id,'budget','500 synthetic units','Synthetic budget');const impact=await m.share(launch.id,fact.id,travel.id);assert.equal(impact.length,2);assert.deepEqual((await m.context(travel.id)).map(f=>f.key),['venue']);assert.deepEqual(await m.context(unrelated.id),[]);});
test('shared recipient cannot revise or reshare owner fact',async()=>{await assert.rejects(m.revise(travel.id,fact.id,1,'Wrong','Wrong'),{status:403});await assert.rejects(m.share(travel.id,fact.id,unrelated.id),{status:403});});
test('revision impact follows graph edges, keeps evidence history',async()=>{const r=await m.revise(launch.id,fact.id,1,'Studio East','Synthetic corrected booking');assert.equal(r.revision,2);assert.deepEqual(r.affected.map(t=>t.title).sort(),['Launch','Travel']);assert.equal((await m.context(travel.id))[0].value,'Studio East');const h=await m.history(launch.id,fact.id);assert.deepEqual(h.map(x=>x.value),['Studio East','Studio North']);});
test('concurrent duplicate creation has one winner',async()=>{const r=await Promise.allSettled([m.remember(launch.id,'concurrent','a','note a'),m.remember(launch.id,'concurrent','b','note b')]);assert.equal(r.filter(x=>x.status==='fulfilled').length,1);assert.equal((await m.context(launch.id)).filter(x=>x.key==='concurrent').length,1);});
test('stale revisions are refused atomically',async()=>{await assert.rejects(m.revise(launch.id,fact.id,1,'Stale','Stale'),{status:409});assert.equal((await m.context(travel.id))[0].value,'Studio East');});
test('two concurrent corrections cannot both replace the same revision',async()=>{const f=await m.remember(launch.id,'concurrent revision','start','source');const r=await Promise.allSettled([m.revise(launch.id,f.id,1,'next a','note a'),m.revise(launch.id,f.id,1,'next b','note b')]);assert.equal(r.filter(x=>x.status==='fulfilled').length,1);assert.equal((await m.history(launch.id,f.id)).length,2);});
test('revocation removes access to future values and history',async()=>{await m.revoke(launch.id,fact.id,travel.id);assert.deepEqual(await m.context(travel.id),[]);await assert.rejects(m.history(travel.id,fact.id),{status:404});});
test('untrusted model output never supplies unknown ids, mixed writes or Cypher',()=>{assert.throws(()=>validatePlan({topicId:'foreign',newTitle:null,operation:'recall',key:'',value:''},[launch]));assert.throws(()=>validatePlan({topicId:launch.id,newTitle:null,operation:'recall',key:'venue',value:'wrong'},[launch]));assert.throws(()=>validatePlan({topicId:launch.id,newTitle:null,operation:'remember',key:'venue',value:'x',query:'DELETE'},[launch]));});
test('HTTP workspace isolation, explicit confirmation and one-shot proposals (mock model only)',async()=>{
  const graphs=new Set();
  const planner={calls:0,limit:3,plan:async()=>({topicId:null,newTitle:'Synthetic HTTP',operation:'remember',key:'venue',value:'Synthetic hall'})};
  server=await createApp({db,planner,secret:'test-only-secret',port:3061});
  await new Promise(r=>server.listen(3061,'127.0.0.1',r));
  const request=async(path,body,cookie)=>{
    const r=await fetch('http://127.0.0.1:3061/api/'+path,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(cookie?{cookie}: {})},body:body?JSON.stringify(body):undefined});
    const issued=r.headers.get('set-cookie')?.split(';')[0];
    if(issued){const sid=issued.split('=')[1].split('.')[0];graphs.add('theone_'+createHmac('sha256','test-only-secret').update(sid).digest('hex').slice(0,40));}
    return {r,d:await r.json(),cookie:issued};
  };
  try {
    const a=await request('chat',{message:'Remember synthetic hall'});const c=a.cookie;
    assert.equal((await request('confirm',{token:a.d.token,confirmed:true})).r.status,404);
    assert.equal((await request('confirm',{token:a.d.token},c)).r.status,400);
    const written=await request('confirm',{token:a.d.token,confirmed:true},c);
    assert.equal(written.r.status,200);
    assert.equal((await request('confirm',{token:a.d.token,confirmed:true},c)).r.status,404);
    assert.equal((await request('context',{topic:written.d.topic})).r.status,404);
    assert.equal((await request('fact',{topic:written.d.topic,key:'x',value:'y',evidence:'z'},c)).r.status,400);
    assert.equal((await request('topics',undefined,c)).d.topics.length,1);
    assert.equal((await request('topics')).d.topics.length,0);
    const cross=await fetch('http://127.0.0.1:3061/api/topic',{method:'POST',headers:{'content-type':'application/json',origin:'https://example.org',cookie:c},body:JSON.stringify({title:'cross origin'})});
    assert.equal(cross.status,403);
  } finally {for(const name of graphs)await db.selectGraph(name).delete();}
});
test('disconnected graph has no fixture fallback',async()=>{
  const isolated=await connect();const lost=new Memory(isolated,'theone_'+randomBytes(20).toString('hex'));
  await isolated.close();await assert.rejects(lost.topics());
});

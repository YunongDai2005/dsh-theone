// Genuine synthetic development scenarios. No fixture/model fallback, no benchmark accuracy claim.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { connect } from './memory.mjs';
import { Planner } from './agent.mjs';
import { createApp } from './server.mjs';
const port = 3062, secret = 'synthetic-live-verifier-' + Date.now();
const db = await connect(); const planner = new Planner({limit: 3});
const server = await createApp({db, planner, secret, port});
await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
let cookie; const checks=[];
async function api(path, body) {
  const r = await fetch(`http://127.0.0.1:${port}/api/${path}`, {
    method: body ? 'POST' : 'GET', headers: {'content-type':'application/json', ...(cookie ? {cookie} : {})},
    body: body ? JSON.stringify(body) : undefined});
  if (r.headers.get('set-cookie')) cookie = r.headers.get('set-cookie').split(';')[0];
  const data = await r.json();
  if (!r.ok) throw new Error(`${path}: ${r.status} ${data.error}`);
  return data;
}
try {
  const launch = await api('topic',{title:'Launch plan'});
  const travel = await api('topic',{title:'Travel logistics'});
  const unrelated = await api('topic',{title:'Reading list'});
  const first = await api('chat',{message:'For the Launch plan, remember the venue is Studio North.'});
  assert.equal(first.plan.topicId,launch.id);assert.equal(first.plan.operation,'remember');assert.equal(first.plan.key,'venue');
  assert.deepEqual((await api('context',{topic:launch.id})).facts,[]);
  const confirmed = await api('confirm',{token:first.token,confirmed:true});
  const fact = confirmed.fact;
  await api('share',{owner:launch.id,id:fact.id,target:travel.id,confirmed:true});
  checks.push('Real Nemotron note routes to existing topic; confirmation required before FalkorDB write');
  const correction = await api('chat',{message:'For the Launch plan, revise the venue to Studio East. This corrects the previous venue booking.'});
  assert.equal(correction.plan.topicId,launch.id);assert.equal(correction.plan.operation,'revise');assert.equal(correction.expectedRevision,1);
  const revised = await api('confirm',{token:correction.token,confirmed:true});
  assert.deepEqual(revised.fact.affected.map(x=>x.title).sort(),['Launch plan','Travel logistics']);
  assert.equal((await api('context',{topic:travel.id})).facts[0].value,'Studio East');
  assert.deepEqual((await api('context',{topic:unrelated.id})).facts,[]);
  checks.push('Real correction preserves provenance and reaches only the explicitly connected travel topic');
  const recalled = await api('chat',{message:'For Travel logistics, what is the current venue?'});
  assert.equal(recalled.plan.topicId,travel.id);assert.equal(recalled.plan.operation,'recall');assert.equal(recalled.context[0].value,'Studio East');
  assert.equal(recalled.context[0].grant,'explicit user confirmation');
  checks.push('Real recall uses FalkorDB shared path rather than global fact context');
  const history = await api('history',{topic:launch.id,id:fact.id});
  assert.deepEqual(history.history.map(x=>x.value),['Studio East','Studio North']);
  await api('revoke',{owner:launch.id,id:fact.id,target:travel.id,confirmed:true});
  assert.deepEqual((await api('context',{topic:travel.id})).facts,[]);
  const summary={at:new Date().toISOString(),status:'PASS',model:planner.model,realModelRequests:planner.calls,
    database:'Real local FalkorDB pinned vendor image',scope:'3 synthetic development scenarios; no held-out accuracy, score or participant-understanding claim',checks};
  if (process.env.EVIDENCE_PATH) await writeFile(process.env.EVIDENCE_PATH,JSON.stringify(summary,null,2)+'\n');
  console.log(JSON.stringify(summary,null,2));
} finally {
  await new Promise(resolve=>server.close(resolve));
  if (cookie) {const sid=cookie.split('=')[1].split('.')[0];await db.selectGraph('theone_'+createHmac('sha256',secret).update(sid).digest('hex').slice(0,40)).delete();}
  await db.close();
}

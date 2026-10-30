import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../server.mjs'

const until = async (fn, predicate) => {
  for (let i=0;i<100;i++) { const value=await fn(); if(predicate(value)) return value; await new Promise(r=>setTimeout(r,5)) }
  throw new Error('Expected local test state was not reached')
}
test('local API rejects cross-origin writes and bounds one run; cancellation records no invented result', async () => {
  let called=0
  const app=createApp({database:':memory:',endpoint:'http://127.0.0.1:1',execute:({signal,onEvent})=>{
    called++;onEvent({type:'test.fixture',message:'Explicit test executor, no model'})
    return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))
  }})
  const base=await app.listen(0)
  try {
    const status=await (await fetch(base+'/api/status')).json()
    assert.equal(status.ready,false)
    const headers={'Content-Type':'application/json','x-council-token':status.csrfToken}
    const body=JSON.stringify({topic:'Synthetic API test',brief:'No model request occurs in this fixture.'})
    assert.equal((await fetch(base+'/api/runs',{method:'POST',headers:{'Content-Type':'application/json'},body})).status,403)
    assert.equal((await fetch(base+'/api/runs',{method:'POST',headers:{...headers,Origin:'https://example.invalid'},body})).status,403)
    assert.equal((await fetch(base+'/api/runs',{method:'POST',headers,body:JSON.stringify({topic:'x',brief:'x'.repeat(3001)})})).status,400)
    assert.equal(called,0)
    const start=await fetch(base+'/api/runs',{method:'POST',headers,body});assert.equal(start.status,202)
    const {id}=await start.json()
    assert.equal((await fetch(base+'/api/runs',{method:'POST',headers,body})).status,409)
    assert.equal(called,1)
    assert.equal((await fetch(base+`/api/runs/${id}/cancel`,{method:'POST',headers})).status,202)
    const result=await until(async()=> (await fetch(base+`/api/runs/${id}`)).json(),r=>r.status==='cancelled')
    assert.equal(result.result,null);assert.match(result.error,/Cancelled/)
    assert.equal((await fetch(base+'/api/runs/not-an-id')).status,404)
  } finally { await app.close() }
})

test('completed local runs persist across restart and incomplete runs are honestly marked interrupted', async () => {
  const temp=mkdtempSync(join(tmpdir(),'topic-council-test-')),database=join(temp,'test.db')
  let app=createApp({database,endpoint:'http://127.0.0.1:1',execute:async()=>({final:'Explicit fixture output, not an AI result'})})
  let closed=false
  try {
    let base=await app.listen(0)
    const {csrfToken}=await(await fetch(base+'/api/status')).json()
    const start=await fetch(base+'/api/runs',{method:'POST',headers:{'Content-Type':'application/json','x-council-token':csrfToken},body:JSON.stringify({topic:'Persistence fixture',brief:'Synthetic fixture'})})
    const {id}=await start.json()
    const result=await until(async()=> (await fetch(base+`/api/runs/${id}`)).json(),r=>r.status==='completed')
    assert.equal(result.result.final,'Explicit fixture output, not an AI result')
    const interrupted='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    app.db.prepare("INSERT INTO runs(id,created_at,topic,brief,status) VALUES(?,?,?,?, 'running')").run(interrupted,new Date().toISOString(),'Interrupted fixture','No result')
    await app.close();closed=true
    app=createApp({database,endpoint:'http://127.0.0.1:1',execute:async()=>{throw new Error('No replay should occur')}});closed=false
    base=await app.listen(0)
    assert.equal((await(await fetch(base+`/api/runs/${id}`)).json()).result.final,'Explicit fixture output, not an AI result')
    const row=await(await fetch(base+`/api/runs/${interrupted}`)).json()
    assert.equal(row.status,'interrupted');assert.equal(row.result,null)
  } finally { if(!closed)await app.close();rmSync(temp,{recursive:true,force:true}) }
})

test('server refuses a remote inference origin before creating a database',()=>{
  assert.throws(()=>createApp({database:':memory:',endpoint:'https://remote.example.invalid'}),/loopback/)
})

test('an agent failure aborts sibling work and persists a failed run rather than success or user cancellation',async()=>{
  let siblingAborted=false
  const app=createApp({database:':memory:',endpoint:'http://127.0.0.1:1',execute:async({signal})=>{
    signal.addEventListener('abort',()=>{siblingAborted=true},{once:true})
    throw new Error('Explicit failed agent fixture')
  }})
  const base=await app.listen(0)
  try {
    const {csrfToken}=await(await fetch(base+'/api/status')).json()
    const start=await fetch(base+'/api/runs',{method:'POST',headers:{'Content-Type':'application/json','x-council-token':csrfToken},body:JSON.stringify({topic:'Failure fixture',brief:'No real model is used.'})})
    const {id}=await start.json()
    const result=await until(async()=> (await fetch(base+`/api/runs/${id}`)).json(),r=>r.status==='failed')
    assert.equal(siblingAborted,true)
    assert.equal(result.result,null)
    assert.equal(result.error,'Explicit failed agent fixture')
  } finally { await app.close() }
})

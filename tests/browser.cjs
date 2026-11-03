// Local app only, fresh ephemeral browser context. Never uses a personal profile.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const evidence = path.resolve(process.env.EVIDENCE_DIR || path.join(root, 'test-results'));
const port = process.env.TEST_PORT || '3069';
const origin = `http://127.0.0.1:${port}`;
const demoPace = Number(process.env.DEMO_PACE_MS || 0);
const pause = ms => new Promise(r => setTimeout(r, Math.max(ms,demoPace)));
let child, browser;
async function start() {
  child = spawn(process.env.PYTHON || 'python3', ['server.py'], {cwd:root, env:{...process.env,PORT:port,LEDGER_DATA:path.join(evidence,'runtime')}});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('server startup timed out')),10000);child.stdout.once('data',()=>{clearTimeout(timer);resolve();});child.once('error',reject);child.once('exit',code=>{if(code)reject(new Error('server failed '+code));});});
}
async function stop(){if(child && child.exitCode===null){const ended=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await ended;}child=null;}
(async()=>{
  await fs.mkdir(evidence,{recursive:true});await start();
  browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
  const context=await browser.newContext({viewport:{width:1440,height:1040},recordVideo:{dir:path.join(evidence,'video'),size:{width:1440,height:1040}}});
  await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin);await page.getByRole('button',{name:'Load synthetic example'}).click();
  await page.locator('#tickets').waitFor();await page.waitForFunction(()=>document.querySelector('#tickets').value.includes('T-1041'));
  await page.screenshot({path:path.join(evidence,'01-import.png'),fullPage:true});await pause(700);
  await page.getByRole('button',{name:'Import & validate'}).click();
  await page.getByRole('button',{name:'Investigate tickets'}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.case').length===5);
  assert.equal(await page.locator('#count').innerText(),'5');assert.equal(await page.locator('#attention').innerText(),'4');
  await page.screenshot({path:path.join(evidence,'02-investigate.png'),fullPage:true});await pause(700);
  for(let i=0;i<5;i++){
    await page.locator('.case').nth(i).getByRole('button',{name:'Review',exact:true}).click();
    await page.locator('#decision').selectOption(i===4?'hold':'approve');
    await page.locator('#note').fill(i===4?'Order absent from snapshot; held for source verification.':'Checked synthetic ticket against the supplied shipment record. Approve internal follow-up only.');
    if(demoPace) await new Promise(r=>setTimeout(r,demoPace/2));
    if(i===1){await page.screenshot({path:path.join(evidence,'03-review.png')});await pause(900);}
    await page.getByRole('button',{name:'Save decision'}).click();
    await page.locator('#review-dialog').waitFor({state:'hidden'});
  }
  await page.getByRole('button',{name:'Create reviewed handoff'}).click();await page.locator('#handoff').waitFor();
  assert.equal(await page.locator('#records').innerText(),'4');
  const exportPath=await page.locator('#json-export').getAttribute('href');
  const bundle=await page.evaluate(p=>fetch(p).then(r=>r.json()),exportPath);
  await fs.writeFile(path.join(evidence,'actual-browser-export.json'),JSON.stringify(bundle,null,2)+'\n');
  const run=bundle.workflow;
  const replay=await page.evaluate(async({id,revision})=>{const r=await fetch('/api/runs/'+id+'/execute',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision})});return {status:r.status,data:await r.json()};},{id:run.id,revision:run.revision-1});
  assert.equal(replay.status,200);assert.equal(replay.data.artifacts.length,4);assert.equal(replay.data.data.events.filter(e=>e.event==='executed').length,1);
  await page.evaluate(()=>scrollTo(0,0));
  await page.screenshot({path:path.join(evidence,'04-completed.png'),fullPage:true});await pause(900);
  await stop();await start();await page.reload();
  await page.locator('#history button').filter({hasText:run.id.slice(0,8)}).click();await page.locator('#handoff').waitFor();
  assert.equal(await page.locator('#records').innerText(),'4');
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>scrollTo(0,0));
  await page.screenshot({path:path.join(evidence,'05-mobile.png'),fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'mobile horizontal overflow');
  assert.deepEqual(errors,[]);
  const other=await browser.newContext();const otherPage=await other.newPage();await otherPage.goto(origin);
  const isolation=await otherPage.evaluate(p=>fetch(p).then(r=>r.status),'/api/runs/'+run.id);assert.equal(isolation,404);await other.close();
  const video=page.video();await context.close();
  await fs.writeFile(path.join(evidence,'browser-receipt.json'),JSON.stringify({checked_at:new Date().toISOString(),input:'five synthetic tickets; four synthetic shipments',workflow_id:run.id,internal_records:4,held:1,real_browser:true,actual_process_restart:true,replay_executions:1,other_workspace_read_status:isolation,mobile_width:390,horizontal_overflow:false,console_errors:errors,video:await video.path(),model_calls:0,provider_calls:0,external_messages:0,deployed_on_vultr:false},null,2)+'\n');
  console.log('PASS: browser import, investigate, five reviews, four artifacts, one hold, idempotent replay, real process restart, workspace isolation and mobile layout.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();await stop();});

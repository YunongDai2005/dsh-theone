// Browser integration checks against this merged app. Uses an isolated in-memory database and simulated providers.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createApp } from './server.mjs';
import { previewPlanner, previewTopics, previewPayPal } from './preview.mjs';
const req=createRequire(import.meta.url);
const playwrightModule=process.env.PLAYWRIGHT_MODULE || 'playwright';
const { chromium }=req(playwrightModule);
const { expect }=req(playwrightModule+'/test');
const output=resolve(process.argv[2] || fileURLToPath(new URL('./.data/ui-verification.json',import.meta.url)));
mkdirSync(dirname(output),{recursive:true});
let failure=null;
const app=createApp({planner:previewPlanner,topics:previewTopics,paypal:previewPayPal(),preview:true});
await new Promise(r=>app.listen(0,'127.0.0.1',r));
const url=`http://127.0.0.1:${app.address().port}`;
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:{})});
const context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'});
const page=await context.newPage(),checks=[],errors=[];
page.on('pageerror',e=>errors.push(e.message));
const pass=label=>{checks.push(label);console.log('PASS '+label);};
const snapshot=()=>page.evaluate(async()=>{const token=/const token='([a-f0-9]+)'/.exec(document.querySelector('script').textContent)[1];return fetch('/state',{headers:{'X-TheOne-Token':token}}).then(r=>r.json());});
const send=async text=>{await page.locator('#message').fill(text);await page.locator('#send').click();await expect(page.locator('#send')).toBeEnabled();await expect(page.locator('#message')).toHaveValue('');};
const amount=p=>p.payload.items[0].unit_amount.value;
try {
 await page.goto(url);await expect(page.locator('.insp-empty')).toBeVisible();
 await send('Draft a 480 EUR invoice for the design client for website assets.');
 let s=await snapshot();const first=s.proposals[0].id;assert.equal(amount(s.proposals[0]),'480.00');pass('Create a reviewed draft through the composer');
 await page.locator('#message').fill('One\nTwo\nThree\nFour');assert.equal(await page.locator('#message').evaluate(e=>e.clientHeight),124);
 await page.locator('#message').fill('');assert.equal(await page.locator('#message').evaluate(e=>e.clientHeight),40);pass('Multiline composer grows and resets');
 await send('Record 72 EUR of moving expenses in my household budget. Do not create an invoice.');
 s=await snapshot();assert.equal(s.routing.currentId,'budget');assert.equal(s.proposals.length,1);pass('Budget notes keep invoice records separate');
 await page.getByRole('button',{name:'Revise the amount',exact:true}).click();const suggested=await page.locator('#message').inputValue();assert.match(suggested,/TO-/);await page.locator('#send').click();await expect(page.locator('#send')).toBeEnabled();
 s=await snapshot();assert.equal(amount(s.proposals[0]),'520.00');assert.equal(s.proposals[0].revision,2);pass('Revision shortcut targets selected invoice across project switches');
 await send('Draft a separate 120 EUR invoice for the design client for consultation.');s=await snapshot();const other=s.proposals.find(p=>p.id!==first).id;
 await page.locator('.draft').filter({hasText:'520.00 EUR'}).click();await page.getByRole('button',{name:'Revise the amount',exact:true}).click();await page.locator('#message').fill((await page.locator('#message').inputValue()).replace('to 520 EUR.','to 550 EUR.'));await page.locator('#send').click();await expect(page.locator('#send')).toBeEnabled();
 s=await snapshot();assert.equal(amount(s.proposals.find(p=>p.id===first)),'550.00');assert.equal(amount(s.proposals.find(p=>p.id===other)),'120.00');pass('Multiple drafts remain isolated when revising the selected one');
 await page.getByRole('button',{name:'Edit',exact:true}).click();await page.getByLabel('Amount',{exact:true}).fill('560');await page.getByLabel('Service',{exact:true}).fill('Website design and brand assets');await page.getByRole('button',{name:'Save as a new revision',exact:true}).click();await expect(page.getByRole('button',{name:'Edit',exact:true})).toBeVisible();
 s=await snapshot();assert.equal(amount(s.proposals.find(p=>p.id===first)),'560.00');pass('Manual edit updates amount and service with revision history');
 await page.getByRole('button',{name:'Change',exact:true}).click();await page.getByLabel('Project',{exact:true}).selectOption('move');await page.getByRole('button',{name:'Move and review again',exact:true}).click();await expect(page.getByRole('button',{name:'Edit',exact:true})).toBeVisible();s=await snapshot();assert.equal(s.proposals.find(p=>p.id===first).payload.primary_recipients[0].billing_info.email_address,'move-buyer@example.invalid');pass('Project correction updates recipient');
 await page.locator('.draft').filter({hasText:'120.00 EUR'}).click();await page.getByRole('button',{name:'Discard',exact:true}).click();await page.getByRole('button',{name:'Discard draft',exact:true}).click();await expect(page.locator('#send')).toBeEnabled();s=await snapshot();assert.equal(s.proposals.find(p=>p.id===other).state,'DISCARDED');pass('Discard closes only the selected local draft');
 await page.locator('.draft').filter({hasText:'560.00 EUR'}).click();await page.getByRole('button',{name:'Create demo draft',exact:true}).click();await expect(page.locator('.banner')).toContainText('Simulated draft created');s=await snapshot();assert.equal(s.proposals.find(p=>p.id===first).state,'CREATED');pass('Explicit approval creates and verifies a simulated PayPal draft');
 await send('Draft a 300 EUR invoice for that client for project services.');s=await snapshot();assert.equal(s.proposals.length,2);await expect(page.locator('.pill.ask').last()).toBeVisible();await page.locator('.quick').getByRole('button',{name:'Moving project',exact:true}).click();await expect(page.locator('#send')).toBeEnabled();s=await snapshot();assert.equal(s.proposals.length,3);assert.equal(amount(s.proposals.at(-1)),'300.00');assert.equal(s.proposals.at(-1).topic_id,'move');pass('Client clarification resumes the original invoice request');
 // Lose a successful response, then submit the retained text again. Both requests must use one replay key.
 const ids=[];let lost=false;
 await page.route('**/plan',async route=>{ids.push(route.request().postDataJSON().request_id);if(!lost){lost=true;await route.fetch();await route.abort('failed');}else await route.continue();});
 await page.locator('#message').fill('Draft a separate 610 EUR invoice for the design client for website assets.');await page.locator('#send').click();await expect(page.locator('#send')).toBeEnabled();await expect(page.locator('#message')).not.toHaveValue('');await page.locator('#send').click();await expect(page.locator('#send')).toBeEnabled();await expect(page.locator('#message')).toHaveValue('');s=await snapshot();assert.equal(ids.length,2);assert.equal(ids[0],ids[1]);assert.equal(s.proposals.filter(p=>amount(p)==='610.00').length,1);await page.unroute('**/plan');pass('Lost response retry reuses the request ID without duplicating a draft');
 await page.getByRole('button',{name:'Switch to dark theme'}).click();await page.reload();await expect(page.locator('html')).toHaveAttribute('data-theme','dark');await expect(page.locator('.sheet')).toBeVisible();assert.equal(await page.locator('.sheet').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(255, 255, 255)');pass('Dark preference persists and invoice document stays readable');
 for(const width of [320,375,430,768]){
  await page.setViewportSize({width,height:812});await page.locator('#open-side').click();await expect(page.locator('#side')).toHaveAttribute('role','dialog');
  assert.equal(await page.locator('#side').evaluate(e=>e.scrollWidth<=e.clientWidth),true,`side overflow ${width}`);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`body overflow ${width}`);
  const heads=await page.locator('.item.head span').evaluateAll(els=>els.map(e=>e.scrollWidth<=e.clientWidth));assert.ok(heads.every(Boolean),`header text overflow ${width}`);
  await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>document.querySelector('#side').contains(document.activeElement)),true);
  await page.keyboard.press('Escape');await expect(page.locator('#scrim')).toBeHidden();assert.equal(await page.locator('#side').evaluate(e=>e.inert),true);
 }
 pass('320/375/430/768px layouts and keyboard focus confinement');
 await page.locator('#open-side').click();await page.setViewportSize({width:1440,height:900});await expect(page.locator('#scrim')).toBeHidden();assert.equal(await page.locator('.chat').evaluate(e=>e.inert),false);assert.equal(await page.locator('#side').evaluate(e=>e.inert),false);pass('Open mobile drawer resets when switching to desktop');
 // A long service and large amount must remain inside the narrow invoice document.
 await page.getByRole('button',{name:'Edit',exact:true}).click();await page.getByLabel('Amount',{exact:true}).fill('10000.00');await page.getByLabel('Service',{exact:true}).fill('LongWebsiteDesignServiceNameWithoutSpacesForLayoutVerification');await page.getByRole('button',{name:'Save as a new revision',exact:true}).click();await expect(page.getByRole('button',{name:'Edit',exact:true})).toBeVisible();await page.setViewportSize({width:320,height:812});await page.locator('#open-side').click();assert.equal(await page.locator('#side').evaluate(e=>e.scrollWidth<=e.clientWidth),true);const overflowing=await page.locator('.sheet').evaluate(e=>[e,...e.querySelectorAll('*')].filter(n=>n.clientWidth&&n.scrollWidth>n.clientWidth+2).map(n=>n.className));assert.deepEqual(overflowing,[]);pass('Large invoice amounts and unbroken service names wrap safely');
 assert.deepEqual(errors,[]);pass('No uncaught browser errors');
} catch(e){failure=e.message;await page.screenshot({path:resolve(dirname(output),'ui-failure.png')});throw e;}
finally{writeFileSync(output,JSON.stringify({passed:failure===null,checks,errors,failure,frontend_sha256:createHash('sha256').update(readFileSync(new URL('./index.html',import.meta.url))).digest('hex'),real_model_calls:0,real_paypal_calls:0},null,2)+'\n');await browser.close();await new Promise(r=>app.close(r));}

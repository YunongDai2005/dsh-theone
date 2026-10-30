import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { runCouncil, SDK_VERSION } from '../council.mjs';

// These tests execute the genuine pinned Mozaik runtime with explicitly
// SYNTHETIC inference outputs. They are not evidence of a real model run.
const output = text => ({ items: [{ type: 'message', role: 'assistant', content: { type: 'output_text', text } }], tokenUsage: undefined, rowResponse: { synthetic: true } });
const deferred = () => { let resolve; let reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flatten = input => input.context.getItems().map(item => item.content?.text ?? '').join('\n');
const drain = () => new Promise(resolve => setImmediate(resolve));

test('synthetic: two genuine SDK loops reach the runner before either is released; third reads shared outputs', async () => {
  const both = deferred();
  const gates = [deferred(), deferred()];
  const calls = [];
  const events = [];
  const runner = { async run(input) {
    calls.push({ phase: input.traceLabel, text: flatten(input) });
    if (calls.length <= 2) {
      const index = calls.length - 1;
      if (calls.length === 2) both.resolve();
      return await gates[index].promise;
    }
    return output('SYNTHETIC FINAL: add the risk mitigation to the plan.');
  } };
  const pending = runCouncil({ topic: 'Community workshop', brief: 'Prepare a free one-hour workshop.', runner, onEvent: event => events.push(event) });
  await both.promise;
  assert.equal(calls.length, 2);
  assert.deepEqual(new Set(calls.map(call => call.phase)), new Set(['plan', 'risk']));
  // No timers or simulated latency: each initial loop waits on its own gate.
  gates[0].resolve(output('SYNTHETIC PLAN: choose a room and run a short exercise.'));
  gates[1].resolve(output('SYNTHETIC RISK: check accessibility before choosing the room.'));
  const result = await pending;
  assert.equal(calls.length, 3);
  assert.equal(calls[2].phase, 'reconcile');
  assert.ok(calls[2].text.includes(result.plan));
  assert.ok(calls[2].text.includes(result.risk));
  assert.match(result.final, /SYNTHETIC FINAL/);
  assert.equal(result.sdkVersion, SDK_VERSION);
  const started = result.trace.filter(event => event.type === 'inference.started');
  assert.equal(new Set(started.map(event => event.loopId)).size, 3);
  assert.equal(new Set(started.map(event => event.agentId)).size, 2);
  assert.equal(result.overlap.concurrent, true);
  assert.ok(result.overlap.overlapMs > 0);
  assert.equal(result.overlap.intervals.length, 2);
  assert.ok(result.trace.findIndex(event => event.key === 'risk') < result.trace.findIndex(event => event.type === 'reconcile.started'));
  assert.deepEqual(events, result.trace);
  assert.doesNotThrow(() => JSON.stringify(result));
});

test('synthetic: inference failure rejects without a final answer or a reconciliation call', async () => {
  const both = deferred();
  const gates = [deferred(), deferred()];
  let calls = 0;
  const pending = runCouncil({ topic: 'Failure test', brief: 'This is synthetic.', runner: { async run() {
    const index = calls++;
    if (calls === 2) both.resolve();
    return await gates[index].promise;
  } } });
  const rejection = assert.rejects(pending, error => {
    assert.equal(error.message, 'SYNTHETIC transport failure');
    assert.ok(error.trace.some(event => event.type === 'council.failed'));
    assert.equal(error.trace.some(event => event.type === 'council.completed'), false);
    return true;
  });
  await both.promise;
  gates[0].reject(new Error('SYNTHETIC transport failure'));
  gates[1].resolve(output('SYNTHETIC late risk output'));
  await rejection;
  await drain();
  assert.equal(calls, 2);
});

test('synthetic: cancellation rejects, detaches events and prevents reconciliation after late outputs', async () => {
  const both = deferred();
  const gates = [deferred(), deferred()];
  const controller = new AbortController();
  const events = [];
  let calls = 0;
  const pending = runCouncil({ topic: 'Cancellation test', brief: 'Synthetic only.', signal: controller.signal,
    onEvent: event => events.push(event), runner: { async run() {
      const index = calls++;
      if (calls === 2) both.resolve();
      return await gates[index].promise;
    } } });
  const rejection = assert.rejects(pending, { name: 'AbortError', code: 'COUNCIL_ABORTED' });
  await both.promise;
  controller.abort();
  await rejection;
  const count = events.length;
  gates.forEach(gate => gate.resolve(output('SYNTHETIC late output')));
  await drain();
  assert.equal(calls, 2);
  assert.equal(events.length, count);
  assert.equal(events.some(event => event.type === 'council.completed'), false);
});

test('synthetic: empty or tool-call output is rejected without executing any tool or retrying', async () => {
  for (const invalid of [output(''), { items: [{ type: 'function_call', name: 'unexpected', args: '{}' }] }]) {
    let calls = 0;
    await assert.rejects(runCouncil({ topic: 'Invalid result', brief: 'Synthetic only.', runner: { async run() { calls++; return invalid; } } }), /non-empty text answer/);
    await drain();
    assert.ok(calls <= 2);
  }
});

test('synthetic: separate councils use isolated shared state and agent identities', async () => {
  const make = marker => runCouncil({ topic: marker, brief: `${marker} only.`, runner: { async run(input) {
    assert.ok(flatten(input).includes(marker));
    assert.equal(flatten(input).includes(marker === 'ALPHA' ? 'BETA' : 'ALPHA'), false);
    return output(`${marker} ${input.traceLabel}`);
  } } });
  const [a, b] = await Promise.all([make('ALPHA'), make('BETA')]);
  assert.equal(a.plan, 'ALPHA plan');
  assert.equal(b.risk, 'BETA risk');
  assert.equal(new Set([...a.agents, ...b.agents].map(agent => agent.id)).size, 4);
});

test('synthetic prompt boundary: final stage receives the original constraints again alongside unverified shared drafts', async () => {
  const topic = 'A neighbourhood repair session';
  const brief = 'Use existing tools only; spend nothing. Do not collect personal data. Venue permission is unknown.';
  const prompts = [];
  const runner = { async run(input) {
    const messages = input.context.getItems();
    const latest = messages.filter(item => item.role === 'user').at(-1).content.text;
    prompts.push({ phase: input.traceLabel, latest, instruction: messages[0].content.text });
    return output(`SYNTHETIC ${input.traceLabel}: unverified draft content.`);
  } };
  const result = await runCouncil({ topic, brief, runner });
  for (const first of prompts.slice(0, 2)) {
    assert.match(first.latest, /FIRST ROUND/);
    assert.match(first.latest, /No other agent's output is available yet/);
    assert.equal(first.latest.includes('SYNTHETIC'), false);
  }
  const final = prompts.find(prompt => prompt.phase === 'reconcile');
  assert.ok(final.latest.includes(topic));
  assert.ok(final.latest.includes(brief));
  assert.ok(final.latest.includes(result.plan));
  assert.ok(final.latest.includes(result.risk));
  assert.match(final.latest, /original brief is authoritative/);
  assert.match(final.latest, /unverified draft/);
  assert.match(final.latest, /GO\/NO-GO/);
  // This checks context delivery, not whether an actual model obeys the prompt.
});

test('input validation happens before invoking an inference runner', async () => {
  let calls = 0;
  const runner = { async run() { calls++; return output('unused'); } };
  await assert.rejects(runCouncil({ topic: ' ', brief: 'Brief', runner }), /non-empty/);
  await assert.rejects(runCouncil({ topic: 'Topic', brief: 'x'.repeat(4001), runner }), /4000/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(runCouncil({ topic: 'Topic', brief: 'Brief', runner, signal: controller.signal }), { name: 'AbortError' });
  assert.equal(calls, 0);
});

test('privacy guard refuses an existing .env before SDK import or credential content reads', () => {
  const directory = mkdtempSync(join(tmpdir(), 'council-env-test-'));
  try {
    writeFileSync(join(directory, '.env'), 'MOZAIK_API_KEY=SYNTHETIC_TEST_VALUE\n');
    const script = `
      import fs from 'node:fs';
      import {syncBuiltinESMExports} from 'node:module';
      let reads=0; let fetches=0;
      const original=fs.readFileSync;
      fs.readFileSync=function(path,...args){ if(String(path).endsWith('/.env')){reads++;throw new Error('Unexpected credential read');} return original.call(this,path,...args); };
      syncBuiltinESMExports();
      globalThis.fetch=async()=>{fetches++;throw new Error('No network allowed');};
      const {runCouncil}=await import(${JSON.stringify(new URL('../council.mjs', import.meta.url).href)});
      let code='';
      try {await runCouncil({topic:'Synthetic',brief:'Synthetic',runner:{run(){throw new Error('Must not run');}}});} catch(error){code=error.code;}
      console.log(JSON.stringify({code,reads,fetches}));
    `;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: directory, encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
    assert.deepEqual(JSON.parse(child.stdout), { code: 'LOCAL_MODE_ENV_FILE', reads: 0, fetches: 0 });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('pinned SDK boundary: import has no credential read; empty process key skips cache and sends zero telemetry', () => {
  const directory = mkdtempSync(join(tmpdir(), 'council-telemetry-test-'));
  try {
    const script = `
      import fs from 'node:fs';
      import {syncBuiltinESMExports} from 'node:module';
      let cacheReads=0; let envReads=0; let fetches=0;
      const original=fs.readFileSync;
      process.env.MOZAIK_API_KEY='SYNTHETIC_DO_NOT_USE';
      process.env.MOZAIK_PROJECT_KEY='SYNTHETIC_DO_NOT_USE';
      process.env.MOZAIK_CREDENTIALS_FILE=${JSON.stringify(join(directory, 'synthetic-credentials.json'))};
      fs.readFileSync=function(path,...args){
        if(String(path).includes('credentials.json')){cacheReads++;throw new Error('Unexpected cache read');}
        if(String(path).endsWith('/.env')) envReads++;
        return original.call(this,path,...args);
      };
      syncBuiltinESMExports();
      globalThis.fetch=async()=>{fetches++;throw new Error('No network allowed');};
      const {runCouncil,ensureLocalMode}=await import(${JSON.stringify(new URL('../council.mjs', import.meta.url).href)});
      ensureLocalMode();
      await import(${JSON.stringify(import.meta.resolve('@mozaik-ai/core'))});
      const before={cacheReads,envReads,fetches};
      const result=await runCouncil({topic:'Synthetic privacy test',brief:'Synthetic only',runner:{async run(input){return {items:[{type:'message',role:'assistant',content:{type:'output_text',text:'SYNTHETIC '+input.traceLabel}}]};}}});
      console.log(JSON.stringify({before,cacheReads,envReads,fetches,keyIsEmpty:process.env.MOZAIK_API_KEY==='',loops:new Set(result.trace.filter(e=>e.type==='inference.started').map(e=>e.loopId)).size}));
    `;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: directory, encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
    const observed = JSON.parse(child.stdout);
    assert.deepEqual(observed.before, { cacheReads: 0, envReads: 0, fetches: 0 });
    assert.equal(observed.cacheReads, 0);
    assert.equal(observed.fetches, 0);
    assert.equal(observed.envReads, 3); // SDK attempts absent .env once per loop; no file content exists to read.
    assert.equal(observed.keyIsEmpty, true);
    assert.equal(observed.loops, 3);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('synthetic CLI transport: environment endpoint is used; one failure aborts the pending sibling request', { timeout: 10_000 }, async t => {
  const responses = [];
  const siblingClosed = deferred();
  const server = createServer((req, res) => {
    req.resume();
    responses.push(res);
    if (responses.length === 2) {
      responses[1].once('close', siblingClosed.resolve);
      responses[0].writeHead(503);
      responses[0].end('SYNTHETIC failure');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { for (const res of responses) res.destroy(); server.closeAllConnections(); server.close(); });
  const child = spawn(process.execPath, [fileURLToPath(new URL('../demo.mjs', import.meta.url)), '--topic', 'Synthetic CLI', '--brief', 'Offline transport test.'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, COUNCIL_OLLAMA_URL: `http://127.0.0.1:${server.address().port}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  let stdout = ''; let stderr = '';
  child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
  const exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  await siblingClosed.promise;
  assert.equal(exitCode, 1);
  assert.equal(responses.length, 2);
  assert.equal(stdout, '');
  assert.match(stderr, /failed-local-inference/);
  assert.match(stderr, /HTTP 503/);
  assert.equal(stderr.includes('council.completed'), false);
});

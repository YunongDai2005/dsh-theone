// OFFLINE tests: every Ollama response here is an invented fixture, never model evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createLocalRunner } from '../local-runner.mjs';

const input = (text = 'Synthetic offline test') => ({ model: 'gemma3:1b', maxOutputTokens: 64,
  context: { getItems: () => [
    { type: 'message', role: 'system', content: { type: 'input_text', text: 'Be brief.' } },
    { type: 'message', role: 'user', content: { type: 'input_text', text } },
  ] } });
const output = () => ({ model: 'gemma3:1b', done: true, done_reason: 'stop', message: { role: 'assistant', content: 'MOCK offline response' }, prompt_eval_count: 12, eval_count: 4 });
const ok = () => new Response(JSON.stringify(output()));

test('reject remote/credentialed endpoints and cloud or unapproved models before any request', () => {
  for (const endpoint of ['https://example.com', 'http://192.168.1.2:11434', 'http://127.0.0.1.evil.test',
    'http://user:secret@127.0.0.1:11537', 'http://127.0.0.1:11537/api', 'http://127.0.0.1:11537/?x=1']) {
    assert.throws(() => createLocalRunner({ endpoint }), /loopback/);
  }
  assert.throws(() => createLocalRunner({ model: 'gemma3:cloud' }), /preinstalled/);
});

test('map SDK-shaped messages to local chat request and output without leaking model options', async () => {
  let request;
  const runner = createLocalRunner({ endpoint: 'http://localhost:11537', fetchImpl: async (url, options) => {
    request = { url, options, data: JSON.parse(options.body) }; return ok();
  } });
  const result = await runner.run(input());
  assert.equal(request.url, 'http://127.0.0.1:11537/api/chat');
  assert.equal(request.options.redirect, 'error');
  assert.deepEqual(request.data.messages.map(m => m.role), ['system', 'user']);
  assert.equal(request.data.stream, false); assert.equal(request.data.options.num_predict, 64);
  assert.equal(request.data.options.num_ctx, 8192);
  assert.equal(result.items[0].type, 'message'); assert.equal(result.items[0].role, 'assistant');
  assert.equal(result.items[0].content.text, output().message.content);
  assert.equal(result.tokenUsage.totalTokens, 16); assert.equal(result.rowResponse.model, 'gemma3:1b');
  assert.deepEqual(runner.getStats().events.map(e => e.phase), ['begin', 'end']);
  assert.equal(runner.getStats().events[1].outcome, 'success');
  assert.equal(runner.getStats().events[1].doneReason, 'stop');
  assert.equal(runner.getStats().events[1].inputTokens, 12);
  assert.equal(runner.getStats().events[1].outputTokens, 4);
});

test('multibyte context above the UTF-8 byte budget fails before any request or truncation', async () => {
  let requests = 0;
  const runner = createLocalRunner({ fetchImpl: async () => { requests++; return ok(); } });
  const text = '中'.repeat(2200);
  assert.ok(text.length < 3000, 'character count alone would accept this brief');
  assert.ok(Buffer.byteLength(text, 'utf8') > 6500);
  await assert.rejects(runner.run(input(text)), /6500 UTF-8 byte.*Nothing was sent or truncated/);
  assert.equal(requests, 0);
  assert.equal(runner.getStats().calls, 0);
  assert.deepEqual(runner.getStats().events, []);
});

test('reserve budget synchronously across overlapping requests and retain failed attempts', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const runner = createLocalRunner({ maxCalls: 2, fetchImpl: async () => { await gate; return ok(); } });
  const a = runner.run(input()), b = runner.run(input());
  await assert.rejects(runner.run(input()), /budget exhausted/);
  assert.equal(runner.getStats().calls, 2); assert.equal(runner.getStats().maxInflight, 2);
  release(); await Promise.all([a, b]); assert.equal(runner.getStats().inflight, 0);
  const failed = createLocalRunner({ maxCalls: 1, fetchImpl: async () => { throw Error('MOCK network failure'); } });
  await assert.rejects(failed.run(input()), /MOCK/);
  await assert.rejects(failed.run(input()), /budget exhausted/);
  assert.equal(failed.getStats().events[1].outcome, 'error');
});

test('empty or mismatched model output fails instead of manufacturing text', async () => {
  for (const patch of [{ message: { role: 'assistant', content: ' ' } }, { model: 'other' }, { done: false }]) {
    const runner = createLocalRunner({ fetchImpl: async () => new Response(JSON.stringify({ ...output(), ...patch })) });
    await assert.rejects(runner.run(input()), /complete nonempty/);
  }
});

test('truncated or unknown completion fails while retaining its actual reported token usage', async () => {
  for (const done_reason of ['length', 'load', 'unrecognized', undefined]) {
    let requests = 0;
    const runner = createLocalRunner({ maxCalls: 1, fetchImpl: async () => {
      requests++;
      return new Response(JSON.stringify({ ...output(), done_reason, eval_count: 64 }));
    } });
    await assert.rejects(runner.run(input()), /did not stop normally.*No partial answer/);
    const stats = runner.getStats();
    assert.equal(stats.calls, 1); assert.equal(stats.inflight, 0);
    assert.equal(stats.events[1].outcome, 'error');
    assert.equal(stats.events[1].doneReason, done_reason);
    assert.equal(stats.events[1].inputTokens, 12); assert.equal(stats.events[1].outputTokens, 64);
    await assert.rejects(runner.run(input()), /budget exhausted/);
    assert.equal(requests, 1, 'the partial response must not trigger a hidden retry');
  }
});

test('pre-abort consumes no request; cancellation and timeout abort active transports', async () => {
  const controller = new AbortController(); controller.abort(); let called = 0;
  const aborted = createLocalRunner({ signal: controller.signal, fetchImpl: async () => { called++; return ok(); } });
  await assert.rejects(aborted.run(input()), { name: 'AbortError' }); assert.equal(called, 0);
  const activeController = new AbortController();
  const active = createLocalRunner({ signal: activeController.signal, fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
  }) });
  const pending = active.run(input()); activeController.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(active.getStats().calls, 1); assert.equal(active.getStats().inflight, 0);
  const runner = createLocalRunner({ timeoutMs: 5, fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
    // The interval only keeps this offline test alive while AbortSignal's unref timer fires.
    const keepAlive = setInterval(() => {}, 100);
    options.signal.addEventListener('abort', () => { clearInterval(keepAlive); reject(options.signal.reason); }, { once: true });
  }) });
  await assert.rejects(runner.run(input()), { name: 'TimeoutError' }); assert.equal(runner.getStats().inflight, 0);
});

test('stream emits one SDK-shaped completion event without invented token chunks', async () => {
  const runner = createLocalRunner({ fetchImpl: async () => ok() });
  const events = [];
  for await (const event of runner.stream(input())) events.push(event);
  assert.equal(events.length, 1); assert.equal(events[0].type, 'inference.output');
  assert.ok(events[0].occurredAt instanceof Date); assert.equal(events[0].payload.items[0].content.text, output().message.content);
});

test('actual local redirect is rejected before a second HTTP request', async t => {
  let calls = 0;
  const server = createServer((_req, res) => { calls++; res.writeHead(302, { Location: '/must-not-follow' }); res.end(); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const runner = createLocalRunner({ endpoint: `http://127.0.0.1:${server.address().port}` });
  await assert.rejects(runner.run(input()), /fetch failed/);
  assert.equal(calls, 1);
});

#!/usr/bin/env node
// Real local inference only. Unit tests use a separate, explicitly synthetic runner.
import { parseArgs } from 'node:util';
import { writeFile } from 'node:fs/promises';
import { runCouncil } from './council.mjs';
import { createLocalRunner } from './local-runner.mjs';

const { values } = parseArgs({ options: {
  topic: { type: 'string', default: 'Plan a free community workshop' },
  brief: { type: 'string', default: 'Design a one-hour beginner workshop for six people, with no purchases and a clear success check.' },
  endpoint: { type: 'string', default: process.env.COUNCIL_OLLAMA_URL || 'http://127.0.0.1:11537' },
  model: { type: 'string', default: 'gemma3:1b' },
  out: { type: 'string' },
  help: { type: 'boolean', default: false },
} });

if (values.help) {
  console.log('Usage: node demo.mjs [--topic TEXT] [--brief TEXT] [--out result.json]\nUses an already-running loopback Ollama server and local gemma3:1b. Makes three real inference calls; no model download or cloud fallback. Optional --endpoint and --model remain restricted by local-runner.mjs.');
} else {
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once('SIGINT', abort);
  let runner;
  try {
    runner = createLocalRunner({ endpoint: values.endpoint, model: values.model, signal: controller.signal, maxCalls: 3 });
    const result = await runCouncil({ topic: values.topic, brief: values.brief, runner, signal: controller.signal,
      onEvent(event) { if (['inference.started', 'shared-state.updated', 'council.completed'].includes(event.type)) process.stderr.write(`${event.at} ${event.type} ${event.phase ?? ''} ${event.agentId ?? ''}\n`); } });
    const receipt = { mode: 'real-local-inference', capturedAt: new Date().toISOString(), result, runner: runner.getStats() };
    if (values.out) await writeFile(values.out, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify(receipt, null, 2));
  } catch (error) {
    // If one initial agent failed, stop its still-pending sibling HTTP request.
    controller.abort(error);
    console.error(JSON.stringify({ mode: 'failed-local-inference', message: error.message, trace: error.trace ?? [], runner: runner?.getStats() ?? null }, null, 2));
    process.exitCode = 1;
  } finally { process.removeListener('SIGINT', abort); }
}

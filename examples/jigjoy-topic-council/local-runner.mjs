import { randomUUID } from 'node:crypto';

function localEndpoint(value) {
  const url = new URL(value);
  if (url.hostname === 'localhost') url.hostname = '127.0.0.1';
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname) ||
      url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Use an HTTP loopback Ollama origin without credentials, query or path');
  }
  return new URL('/api/chat', url).href;
}

function messagesFrom(input, model) {
  if (!input || input.model !== model) throw new Error(`Only the configured local model ${model} is allowed`);
  if (input.tools?.length || input.structuredOutput || input.reasoningEffort) {
    throw new Error('This local text runner does not implement tools, structured output or reasoning controls');
  }
  const items = input.context?.getItems?.() ?? input.context?.items;
  if (!Array.isArray(items) || !items.length || items.length > 40) throw new Error('Supply 1–40 SDK context messages');
  let utf8Bytes = 0;
  const messages = items.map(item => {
    if (item?.type !== 'message' || !['system', 'developer', 'user', 'assistant'].includes(item.role) ||
        typeof item.content?.text !== 'string' || !item.content.text.trim()) {
      throw new Error('Only nonempty text SDK messages are supported');
    }
    utf8Bytes += Buffer.byteLength(item.content.text, 'utf8');
    return { role: item.role === 'developer' ? 'system' : item.role, content: item.content.text };
  });
  // UTF-8 bytes are a conservative input ceiling, not an exact token count.
  // Leave room in the 8192-token context for the chat template and <=512 output
  // tokens, and refuse excessive text instead of silently truncating it.
  if (utf8Bytes > 6500) throw new Error('Local model context exceeds the conservative 6500 UTF-8 byte input limit; shorten the brief or shared outputs. Nothing was sent or truncated.');
  if (!messages.some(message => message.role === 'user')) throw new Error('A user message is required');
  return messages;
}

/** Mozaik 4.0.6 InferenceRunner backed only by a separately running local Ollama.
 * It neither starts servers nor downloads models. stream() emits the completed
 * SDK-shaped inference.output event; it does not pretend buffered text is token streaming.
 * No SDK import occurs here: the caller installs its local-only guard before
 * dynamically loading Mozaik, whose default cloud telemetry is not used.
 * fetchImpl is an explicit injection point for offline mock tests.
 */
export function createLocalRunner({
  endpoint = 'http://127.0.0.1:11537', model = 'gemma3:1b', onCall,
  signal, maxCalls = 4, timeoutMs = 90_000, fetchImpl = fetch,
} = {}) {
  const url = localEndpoint(endpoint);
  if (model !== 'gemma3:1b') throw new Error('This demo only uses the preinstalled local gemma3:1b model');
  if (!Number.isInteger(maxCalls) || maxCalls < 1 || maxCalls > 4) throw new Error('maxCalls must be between 1 and 4');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) throw new Error('Invalid local inference timeout');
  if (typeof fetchImpl !== 'function' || (onCall !== undefined && typeof onCall !== 'function')) throw new Error('Invalid runner callback');
  let calls = 0, inflight = 0, maxInflight = 0;
  const events = [];
  function emit(event) {
    const snapshot = Object.freeze({ ...event });
    events.push(snapshot);
    // Observability must not turn a completed inference into a retried request.
    try { onCall?.(snapshot); } catch { /* the private event log still records it */ }
  }
  const runner = {
    getStats() { return { calls, inflight, maxInflight, events: events.map(event => ({ ...event })) }; },
    async run(input) {
      const messages = messagesFrom(input, model);
      const maxTokens = input.maxOutputTokens ?? 128;
      if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 512) throw new Error('maxOutputTokens must be between 1 and 512');
      signal?.throwIfAborted();
      if (calls >= maxCalls) throw new Error(`Local inference request budget exhausted (${maxCalls})`);
      // Reserve before any await: concurrent calls share the same hard ceiling.
      calls++; inflight++; maxInflight = Math.max(maxInflight, inflight);
      const callId = randomUUID(), startedAt = new Date().toISOString(), started = performance.now();
      const traceLabel = typeof input.traceLabel === 'string' ? input.traceLabel.slice(0, 80) : undefined;
      const common = { callId, model, startedAt, traceLabel, requestNumber: calls };
      emit({ ...common, phase: 'begin', inflight, maxInflight });
      let outcome = 'error', doneReason, inputTokens, outputTokens;
      try {
        const timeout = AbortSignal.timeout(timeoutMs);
        const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
        const response = await fetchImpl(url, {
          method: 'POST', redirect: 'error', signal: requestSignal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, messages, stream: false, keep_alive: '10m',
            options: { temperature: 0, num_predict: maxTokens, num_ctx: 8192 } }),
        });
        if (!response.ok) throw new Error(`Local Ollama returned HTTP ${response.status}`);
        const data = await response.json();
        // Preserve reported usage even when generation reaches its token limit.
        // A nonempty prefix is not a complete council contribution.
        doneReason = typeof data.done_reason === 'string' ? data.done_reason : undefined;
        inputTokens = Number.isInteger(data.prompt_eval_count) && data.prompt_eval_count >= 0 ? data.prompt_eval_count : undefined;
        outputTokens = Number.isInteger(data.eval_count) && data.eval_count >= 0 ? data.eval_count : undefined;
        if (data.error) throw new Error('Local Ollama reported an inference error');
        if (data.model !== model || data.done !== true || data.message?.role !== 'assistant' ||
            typeof data.message.content !== 'string' || !data.message.content.trim()) {
          throw new Error('Local Ollama did not return a complete nonempty response from the configured model');
        }
        if (doneReason !== 'stop') {
          throw new Error(`Local Ollama did not stop normally (done_reason: ${doneReason ?? 'missing'}). No partial answer was accepted.`);
        }
        let tokenUsage;
        if (inputTokens !== undefined && outputTokens !== undefined) {
          tokenUsage = { inputTokens, outputTokens,
            totalTokens: inputTokens + outputTokens,
            inputTokenDetails: undefined, outputTokenDetails: undefined };
        }
        outcome = 'success';
        return { items: [{ type: 'message', role: 'assistant', content: {
          type: 'output_text', text: data.message.content,
        } }], tokenUsage, rowResponse: data };
      } finally {
        inflight--;
        emit({ ...common, phase: 'end', endedAt: new Date().toISOString(),
          durationMs: performance.now() - started, outcome, doneReason, inputTokens, outputTokens, inflight, maxInflight });
      }
    },
    async *stream(input) {
      const output = await runner.run(input);
      yield { type: 'inference.output', producerId: model, occurredAt: new Date(), payload: output };
    },
  };
  return runner;
}

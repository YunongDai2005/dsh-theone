// Run with the path to a DSH installation containing @earendil-works/pi-ai.
// Uses the installed OpenCode provider but only a loopback HTTP endpoint and a fake key.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

if (!process.argv[2]) throw new Error('Usage: node e2e/opencode-session-probe.mjs <DSH installation>')
const providerPath = resolve(process.argv[2], 'node_modules/@earendil-works/pi-ai/dist/providers/opencode-go.js')
const { opencodeGoProvider } = await import(pathToFileURL(providerPath))
const provider = opencodeGoProvider()
const original = provider.getModels().find(model => model.id === 'deepseek-v4.1-flash')
assert.ok(original, 'expected the reported model in the installed provider catalog')
const requests = []
const server = createServer(async (request, response) => {
  let text = ''
  for await (const chunk of request) text += chunk
  const sessionId = request.headers['x-opencode-session']
  requests.push({ sessionId: sessionId ?? null, model: JSON.parse(text).model })
  if (!sessionId) {
    response.writeHead(400, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: { type: 'MissingSessionID', message: 'Request is missing x-opencode-session and cannot be routed efficiently' } }))
    return
  }
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  const frame = (delta, finish_reason) => `data: ${JSON.stringify({ id: 'local-probe', object: 'chat.completion.chunk', created: 0,
    model: original.id, choices: [{ index: 0, delta, finish_reason }] })}\n\n`
  response.end(frame({ role: 'assistant', content: '{"risk":"low","decision":"allow"}' }, null) + frame({}, 'stop') + 'data: [DONE]\n\n')
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
try {
  const model = { ...original, baseUrl: `http://127.0.0.1:${server.address().port}/v1` }
  const results = []
  for (const sessionId of [undefined, 'theone-topic-transport-probe']) {
    const stream = provider.streamSimple(model, { messages: [{ role: 'user', content: 'Local routing test', timestamp: 0 }] },
      { apiKey: 'local-test-key', ...(sessionId ? { sessionId } : {}), maxRetries: 0 })
    const result = await stream.result()
    results.push({ stopReason: result.stopReason, errorMessage: result.errorMessage })
  }
  assert.equal(requests.length, 2)
  assert.equal(requests[0].sessionId, null)
  assert.equal(requests[1].sessionId, 'theone-topic-transport-probe')
  assert.match(results[0].errorMessage, /MissingSessionID|missing x-opencode-session/)
  assert.equal(results[1].stopReason, 'stop')
  console.log(JSON.stringify({ endpoint: 'loopback mock; no live provider request', requests, results }, null, 2))
} finally {
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
}

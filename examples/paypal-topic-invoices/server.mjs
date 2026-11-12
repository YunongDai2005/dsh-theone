import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { ModelPlanner, PayPalSandbox } from './adapters.mjs';
import { InvoiceWorkflow } from './workflow.mjs';
import { publicError } from './errors.mjs';

export function createApp({ planner, paypal, topics, database = ':memory:', capabilities = { model: true, paypal: true }, preview = false }) {
  const workflow = new InvoiceWorkflow({ planner, paypal, topics, database });
  const token = randomBytes(32).toString('hex');
  const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8').replaceAll('__TOKEN__', token);
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${token}'; style-src 'nonce-${token}'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`);
    const respond = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    const fail = error => { const result = publicError(error); respond(result.status, result.body); };
    const port = server.address()?.port;
    if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(req.headers.host) ||
        (req.headers.origin && ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(req.headers.origin))) {
      respond(403, { error: 'Foreign Host or Origin denied' }); return;
    }
    if (req.method === 'GET' && req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); return;
    }
    if (req.headers['x-theone-token'] !== token) { respond(403, { error: 'Local session token required' }); return; }
    if (req.method === 'GET' && req.url === '/state') {
      // The existing UI consumes proposals in chronological order (latest is .at(-1)).
      respond(200, { topics: workflow.topics(), proposals: workflow.proposals().toReversed(), capabilities, preview, messages: workflow.messages(), routing: workflow.routingState(), mode: preview ? 'Offline preview — simulated providers' : 'PayPal Sandbox drafts only' }); return;
    }
    if (req.method === 'GET' && req.url === '/routing/metrics') { respond(200, workflow.routingMetrics()); return; }
    if (req.method === 'GET' && req.url === '/routing/attempts') { respond(200, workflow.attempts()); return; }
    const inspection = /^\/proposals\/([a-f0-9-]{36})\/(review|history)$/.exec(req.url);
    if (req.method === 'GET' && inspection) {
      try { respond(200, inspection[2] === 'review' ? workflow.review(inspection[1]) : workflow.history(inspection[1])); }
      catch (error) { fail(error); }
      return;
    }
    const brief = /^\/projects\/([a-z0-9_-]{1,40})\/brief$/.exec(req.url);
    if (req.method === 'GET' && brief) {
      try { respond(200, workflow.brief(brief[1])); }
      catch (error) { fail(error); }
      return;
    }
    if (req.method !== 'POST' || !['/plan', '/correct', '/revise', '/approve', '/reconcile', '/discard',
      '/remote/review','/remote/apply','/remote/reconcile','/remote/status'].includes(req.url)) {
      respond(404, { error: 'Unknown route' }); return;
    }
    if (req.headers['content-type'] !== 'application/json') { respond(415, { error: 'JSON required' }); return; }
    try {
      const chunks = []; let length = 0;
      for await (const chunk of req) {
        length += chunk.length;
        if (length > 12_000) { respond(413, { error: 'Request too large' }); req.resume(); return; }
        chunks.push(chunk);
      }
      const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (req.url === '/plan' && !capabilities.model) throw new Error('Configure the model API before proposing');
      if ((['/approve', '/reconcile'].includes(req.url) || req.url.startsWith('/remote/')) && !capabilities.paypal) throw new Error('Configure PayPal Sandbox before creating or checking drafts');
      let result;
      if (req.url === '/plan') result = await workflow.plan(data.message, data.request_id);
      else if (req.url === '/correct') result = workflow.correct(data.id, data.revision, data.topic_id);
      else if (req.url === '/revise') result = workflow.revise(data.id, data.revision, data.changes);
      else if (req.url === '/discard') result = workflow.discard(data.id, data.revision, data.acknowledge_remote_unknown);
      else if (req.url === '/remote/review') result = workflow.reviewRemote(data.id, data.revision, data.action, data.changes);
      else if (req.url === '/remote/apply') result = await workflow.applyRemote(data.id, data.revision, data.action, data.changes, data.digest);
      else if (req.url === '/remote/reconcile') result = await workflow.reconcileRemote(data.id);
      else if (req.url === '/remote/status') result = await workflow.refreshRemote(data.id);
      else if (req.url === '/approve') result = await workflow.approve(data.id, data.digest);
      else result = await workflow.reconcile(data.id);
      respond(200, result);
    } catch (error) { fail(error); }
  });
  server.requestTimeout = 50_000;
  server.on('close', () => workflow.close());
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const env = process.env;
  const missing = name => ({ async route() { throw new Error(`${name} is not configured`); }, async plan() { throw new Error(`${name} is not configured`); },
    async createDraft() { throw new Error(`${name} is not configured`); } });
  const planner = env.MODEL_API_KEY && env.MODEL_BASE_URL && env.MODEL_NAME
    ? new ModelPlanner({ baseUrl: env.MODEL_BASE_URL, apiKey: env.MODEL_API_KEY, model: env.MODEL_NAME,
      disableThinking: env.MODEL_DISABLE_THINKING === 'true', reasoningStyle: env.MODEL_REASONING_STYLE || 'none' })
    : missing('Model API');
  const paypal = env.PAYPAL_SANDBOX_CLIENT_ID && env.PAYPAL_SANDBOX_CLIENT_SECRET
    ? new PayPalSandbox({ clientId: env.PAYPAL_SANDBOX_CLIENT_ID, clientSecret: env.PAYPAL_SANDBOX_CLIENT_SECRET })
    : missing('PayPal Sandbox');
  const topics = env.THEONE_TOPICS_FILE ? JSON.parse(readFileSync(env.THEONE_TOPICS_FILE, 'utf8')) : [
    { id: 'design', title: 'Design client', summary: 'Design services, website assets and their invoices.', recipient: env.SANDBOX_RECIPIENT || 'design-buyer@example.invalid' },
    { id: 'move', title: 'Apartment move', summary: 'Moving logistics, movers and relocation work.', recipient: env.SANDBOX_RECIPIENT || 'move-buyer@example.invalid' },
    { id: 'budget', title: 'Household budget', summary: 'Personal monthly spending and expense categorization; not a customer to invoice.', recipient: env.SANDBOX_RECIPIENT || 'budget-buyer@example.invalid', invoice_enabled: false },
  ];
  const database = env.THEONE_INVOICE_DATABASE || '.data/invoices.sqlite';
  mkdirSync(dirname(database), { recursive: true, mode: 0o700 });
  const app = createApp({ planner, paypal, topics, database, capabilities: {
    model: Boolean(env.MODEL_API_KEY && env.MODEL_BASE_URL && env.MODEL_NAME),
    paypal: Boolean(env.PAYPAL_SANDBOX_CLIENT_ID && env.PAYPAL_SANDBOX_CLIENT_SECRET),
  } });
  const port = Number(env.PORT || 3047);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid port');
  app.listen(port, '127.0.0.1', () => console.log(`TheOne Invoice Desk: http://127.0.0.1:${port} (Sandbox drafts only)`));
}

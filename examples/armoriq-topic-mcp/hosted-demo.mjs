import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createTopicMcp } from './server.mjs';

// Preparation only: starting this entry point makes a network listener public.
// It never accepts an existing notes database or a caller-chosen topic.
export function hostedDemoConfig(env) {
  if (env.THEONE_MCP_PUBLIC_DEMO !== 'SYNTHETIC_ONLY') throw new Error('Explicit synthetic-only hosting acknowledgement required.');
  if (env.THEONE_MCP_DATABASE_PATH || env.THEONE_MCP_TOPIC) throw new Error('Hosted demo cannot use an external database or topic.');
  const bearerToken = env.THEONE_MCP_BEARER_TOKEN;
  if (typeof bearerToken !== 'string' || bearerToken.length < 32 || bearerToken.length > 256 || /\s/.test(bearerToken)) throw new Error('Configure a private synthetic-demo bearer.');
  if (!/^\d{1,5}$/.test(env.PORT ?? '')) throw new Error('Hosting port must be an integer.');
  const port = Number(env.PORT);
  if (port < 1 || port > 65535) throw new Error('Hosting port outside valid range.');
  return { port, host: '0.0.0.0', databasePath: '/tmp/theone-armoriq-synthetic/notes.db',
    topic: 'TheOne hosted synthetic demo', bearerToken, maxRequests: 200 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const config = hostedDemoConfig(process.env);
  const server = createTopicMcp(config);
  server.listen(config.port, config.host, () => console.log('Synthetic-only MCP ready; ephemeral notes, cloud enforcement unverified.'));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
}

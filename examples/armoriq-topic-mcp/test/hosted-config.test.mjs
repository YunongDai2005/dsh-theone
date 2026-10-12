import test from 'node:test';
import assert from 'node:assert/strict';
import { hostedDemoConfig } from '../hosted-demo.mjs';

const prepared = () => ({ THEONE_MCP_PUBLIC_DEMO: 'SYNTHETIC_ONLY', PORT: '10000', THEONE_MCP_BEARER_TOKEN: 's'.repeat(48) });

test('hosted preparation requires acknowledgement, private bearer and valid provider port', () => {
  assert.throws(() => hostedDemoConfig({ ...prepared(), THEONE_MCP_PUBLIC_DEMO: '' }), /acknowledgement/);
  assert.throws(() => hostedDemoConfig({ ...prepared(), THEONE_MCP_BEARER_TOKEN: 'short' }), /bearer/);
  assert.throws(() => hostedDemoConfig({ ...prepared(), THEONE_MCP_BEARER_TOKEN: 's'.repeat(48) + '\n' }), /bearer/);
  for (const PORT of ['0', '65536', '10.5', '-1', '', '10000suffix']) assert.throws(() => hostedDemoConfig({ ...prepared(), PORT }), /port/i);
});

test('hosted preparation rejects private database/topic and fixes synthetic ephemeral scope', () => {
  assert.throws(() => hostedDemoConfig({ ...prepared(), THEONE_MCP_DATABASE_PATH: '/home/user/notes.db' }), /external/);
  assert.throws(() => hostedDemoConfig({ ...prepared(), THEONE_MCP_TOPIC: 'private project' }), /external/);
  const config = hostedDemoConfig(prepared());
  assert.equal(config.databasePath, '/tmp/theone-armoriq-synthetic/notes.db');
  assert.equal(config.topic, 'TheOne hosted synthetic demo');
  assert.equal(config.maxRequests, 200);
  assert.equal(config.port, 10000);
});

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Use Node.js 24 or newer.')
const root = fileURLToPath(new URL('../', import.meta.url))
const cli = join(root, 'node_modules/@deepseek-ai/dsh/lib/bin.js')
const entry = join(root, 'dist/index.js')
if (!existsSync(cli)) throw new Error('Install @deepseek-ai/dsh@0.2.0-rc.2 locally first; see docs/nebius-demo.md.')
if (!existsSync(entry)) throw new Error('Run npm run build first.')
const extra = process.argv.slice(2)
const dumping = extra.includes('--dump-config')
if (!dumping && !process.env.OPENAI_API_KEY) throw new Error('Set OPENAI_API_KEY to your Nebius Token Factory API key.')
const local = resolve(process.env.THEONE_NEBIUS_HOME || join(homedir(), '.theone-nebius-demo'))
mkdirSync(local, { recursive: true, mode: 0o700 })
const home = join(local, 'dsh-home')
const patch = join(local, 'nebius.patch.json')
const profile = 'nebius-theone'
const config = [
  { id: 'llm-pi-ai', config: { providers: { nebius: {
    displayName: 'Nebius Nemotron', apiKeyEnv: 'OPENAI_API_KEY', api: 'openai-completions',
    baseURL: 'https://api.tokenfactory.nebius.com/v1/', retryPolicy: { mode: 'normal', maxRetries: 1 },
    compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false,
      maxTokensField: 'max_tokens', thinkingFormat: 'chat-template',
      chatTemplateKwargs: { enable_thinking: { $var: 'thinking.enabled' } } },
    models: [{ id: 'nvidia/nemotron-3-super-120b-a12b', name: 'Nemotron 3 Super',
      contextWindow: 262144, maxTokens: 2048, reasoningEfforts: { off: null, high: 'high' } }],
  } } } },
  { id: 'agent-default-model', config: { provider: 'theone', model: 'gateway' } },
  { insert: [{ id: 'theone', name: entry, config: { databasePath: join(local, 'contexts.db'),
    gatewayKey: 'nebius-demo', workerProvider: 'nebius', workerModel: 'nvidia/nemotron-3-super-120b-a12b',
    routerMode: 'llm', routerTransport: 'dsh', historyCatalog: false, linkScope: 'off' } }] },
]
writeFileSync(patch, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 })
const args = [cli, '--profile', profile]
if (!existsSync(join(home, 'profiles', profile, 'package.json'))) args.push('--from-default-profile', 'web')
args.push('--patch', patch, ...extra)
if (!dumping) args.push('--host', '127.0.0.1', '--port', process.env.THEONE_NEBIUS_PORT || '3019', '--no-open')
const child = spawn(process.execPath, args, { cwd: root, stdio: 'inherit', env: {
  ...process.env, DSH_HOME: home, DSH_TELEMETRY_MODE: 'FEEDBACK_ONLY',
} })
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
child.on('error', error => { console.error(error.message); process.exitCode = 1 })
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0) })

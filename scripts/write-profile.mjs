import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const target = join(root, '.dsh-test')
await mkdir(target, { recursive: true })
const quote = value => JSON.stringify(value)
const patch = `# Generated local test overlay for DSH 0.2.0-rc.2.
# Run with an isolated DSH_HOME; real model credentials must be configured separately.
- id: agent-default-model
  config:
    provider: theone
    model: gateway
- insert:
    - id: theone
      name: ${quote(join(root, 'dist/index.js'))}
      config:
        databasePath: ${quote(join(target, 'contexts.db'))}
${process.env.THEONE_CONTEXTS_PATH ? `        contextsPath: ${quote(process.env.THEONE_CONTEXTS_PATH)}\n` : ''}\
        gatewayKey: local-prototype
        workerProvider: ${quote(process.env.THEONE_WORKER_PROVIDER ?? 'deepseek-official')}
        workerModel: ${quote(process.env.THEONE_WORKER_MODEL ?? 'deepseek-flash')}
        routerMode: ${quote(process.env.THEONE_ROUTER_MODE ?? 'rules')}
        routerBaseUrl: ${quote(process.env.THEONE_ROUTER_BASE_URL ?? 'https://api.deepseek.com')}
        routerModel: ${quote(process.env.THEONE_ROUTER_MODEL ?? 'deepseek-flash')}
        routerApiKeyEnv: THEONE_ROUTER_API_KEY
        maxDescriptorChars: 4000
        maxResponseChars: 100000
`
await writeFile(join(target, 'cordis.patch.yml'), patch)
console.log(`Created ${join(target, 'cordis.patch.yml')}`)
console.log('This only prepares configuration. It does not start DSH or call a model.')

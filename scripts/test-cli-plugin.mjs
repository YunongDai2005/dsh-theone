// Explicit live integration check. Requires the supplied API key in the environment.
// Installs the packed artifact into a private, disposable DSH profile; existing DSH homes are untouched.
import { mkdtemp, mkdir, writeFile, chmod } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { DatabaseSync } from 'node:sqlite'
import assert from 'node:assert/strict'
import { verifyWorkerEvidence } from './verify-cli-evidence.mjs'
import { packPlugin } from './pack-plugin.mjs'

const exec = promisify(execFile)
const runtime = resolve(process.argv[2] ?? join(homedir(), '.cache/theone/dsh-runtime-0.2.0-rc.2'))
const cli = join(runtime, 'node_modules/@deepseek-ai/dsh/lib/bin.js')
if (!process.env.THEONE_ROUTER_API_KEY) throw new Error('THEONE_ROUTER_API_KEY is required')
const cache = join(homedir(), '.cache/theone')
await mkdir(cache, { recursive: true, mode: 0o700 })
const root = await mkdtemp(join(cache, 'cli-plugin-'))
await chmod(root, 0o700)
const home = join(root, 'home'), workspace = join(root, 'workspace'), profile = join(home, 'profiles/theone-test')
await mkdir(profile, { recursive: true })
await mkdir(workspace)
const npmEnv = { ...process.env }
delete npmEnv.THEONE_ROUTER_API_KEY
delete npmEnv.DEEPSEEK_API_KEY
const packed = await packPlugin(root)
const archive = packed.archive
await writeFile(join(profile, 'package.json'), JSON.stringify({ private: true, type: 'module', dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless'] } } }, null, 2))
await exec(process.execPath, [cli, 'plugin', '--profile', 'theone-test', 'add', archive, '--ignore-scripts'], { cwd: workspace, env: { ...npmEnv, DSH_HOME: home }, timeout: 180000, maxBuffer: 4 * 1024 * 1024 })
await writeFile(join(profile, 'cordis.yml'), '[]\n')
await writeFile(join(root, 'test-safety.mjs'), `export const inject = ['tools']; export function apply(ctx) { ctx.tools.guard(exec => ['theone_search_history','theone_update_state'].includes(exec.name) ? undefined : 'Only TheOne metadata tools are permitted in this integration check.'); }\n`)
await writeFile(join(profile, 'cordis.patch.yml'), `- id: llm-deepseek\n  config:\n    apiKeyEnv: THEONE_ROUTER_API_KEY\n    thinking: disabled\n    maxTokens: 4096\n    retryPolicy:\n      mode: normal\n      maxRetries: 0\n- insert:\n    - id: cli-test-safety\n      name: ${JSON.stringify(join(root, 'test-safety.mjs'))}\n`)
const catalog = [
  { id: 'gpu', title: 'Qwen 显卡部署', summary: 'Qwen 模型在显卡上的部署项目。', entities: ['Qwen', 'ROCm'], keywords: ['显卡', '模型部署'], lastState: '测试项目，尚无进展。' },
  { id: 'paper', title: '视频注意力论文', summary: '视频注意力论文写作项目。', entities: ['论文', '注意力'], keywords: ['写作', '视频'], lastState: '测试项目，尚无进展。' },
]
const catalogPath = join(root, 'contexts.json'), database = join(root, 'contexts.db')
await writeFile(catalogPath, JSON.stringify(catalog))
const env = { ...process.env, DSH_HOME: home, THEONE_DATABASE_PATH: database, THEONE_CONTEXTS_PATH: catalogPath, THEONE_GATEWAY_KEY: 'cli-check', THEONE_ROUTER_MODE: 'llm', THEONE_WORKER_PROVIDER: 'deepseek-official', THEONE_WORKER_MODEL: 'deepseek-flash', DSH_TOOLS_MODE: 'native', NODE_NO_WARNINGS: '1' }
const results = []
const checks = [
  { action: 'MOUNT', context: 'gpu', prompt: '在Qwen显卡部署项目中，记住测试代号 GPU_ORANGE_731。调用 theone_update_state 把这个测试代号记入状态，然后只回复 GPU_ORANGE_731。不要执行其他任务。', expected: 'GPU_ORANGE_731' },
  { action: 'SWAP', context: 'paper', prompt: '切换到视频注意力论文项目，记住本论文的测试代号 PAPER_BLUE_284。只回复 PAPER_BLUE_284。', expected: 'PAPER_BLUE_284' },
  { action: 'SWAP', context: 'gpu', prompt: '回到Qwen显卡部署项目。只回复之前记住的显卡测试代号，不要回复论文代号。', expected: 'GPU_ORANGE_731', absent: 'PAPER_BLUE_284' },
  { action: 'KEEP', context: 'gpu', prompt: '继续Qwen显卡部署项目：必须调用 theone_search_history，query 为 GPU_ORANGE_731，查阅本项目历史，然后只回复查到的测试代号。', expected: 'GPU_ORANGE_731' },
  { action: 'CREATE', prompt: '新话题：阳台盆栽养护。此项目测试代号 PLANT_GREEN_593。请只回复 PLANT_GREEN_593。', expected: 'PLANT_GREEN_593' },
  { action: 'KEEP', resume: true, prompt: '继续刚才的盆栽项目，只回复这个项目的测试代号。', expected: 'PLANT_GREEN_593' },
  { action: 'CREATE', empty: true, prompt: '新话题：英语单词学习。请只回复 EMPTY_READY_417。', expected: 'EMPTY_READY_417' },
]
try {
  await exec(process.execPath, [cli, '--profile', 'theone-test', '--help'], { cwd: workspace, env, timeout: 30000 })
  console.log('Packed plugin / native DSH bundle / CLI profile: loaded')
  let previousId
  for (const [index, check] of checks.entries()) {
    const activeDatabase = check.empty ? join(root, 'empty-contexts.db') : database
    if (check.empty) { env.THEONE_DATABASE_PATH = activeDatabase; delete env.THEONE_CONTEXTS_PATH }
    const args = [cli, '--profile', 'theone-test', '--json']
    if (check.resume) args.push('--session-id', previousId)
    args.push(check.prompt)
    let run
    try { run = await exec(process.execPath, args, { cwd: workspace, env, timeout: 120000, maxBuffer: 4 * 1024 * 1024 }) }
    catch (error) {
      await writeFile(join(root, `failure-${index}.private.json`), JSON.stringify({ stdout: error.stdout, stderr: error.stderr, code: error.code }))
      throw new Error(`CLI check ${index + 1} failed; private diagnostics: ${root}`)
    }
    await writeFile(join(root, `turn-${index}.private.jsonl`), run.stdout)
    const events = run.stdout.trim().split('\n').map(line => JSON.parse(line))
    const final = events.findLast(event => event.type === 'final')
    const answer = final?.text ?? ''
    assert.ok(answer.includes(check.expected), `Check ${index + 1}: expected test code absent`)
    if (check.absent) assert.ok(!answer.includes(check.absent), 'Another project’s code leaked into the answer')
    previousId = events.find(event => event.type === 'session').sessionId
    const db = new DatabaseSync(activeDatabase, { readOnly: true })
    try {
      const row = db.prepare('SELECT * FROM routing_events ORDER BY rowid DESC LIMIT 1').get()
      const decision = JSON.parse(row.decision)
      assert.equal(row.status, 'completed')
      assert.equal(decision.action, check.action)
      if (check.context) assert.equal(decision.contextId, check.context)
      results.push({ check: index + 1, action: decision.action, contextId: decision.contextId, gatewayId: previousId, passed: true })
    } finally { db.close() }
    console.log(`Live CLI check ${index + 1}/${checks.length}: ${check.action} passed`)
  }
  const db = new DatabaseSync(database, { readOnly: true })
  try {
    const state = db.prepare("SELECT * FROM context_state_updates WHERE context_id = 'gpu'").all()
    assert.ok(state.length > 0, 'Real Worker never executed the progress tool')
    assert.ok(state.some(row => row.state.includes('GPU_ORANGE_731')))
    const gpu = db.prepare("SELECT working_session_id FROM contexts WHERE id = 'gpu'").get().working_session_id
    results.push(await verifyWorkerEvidence(root, runtime))
    results.push({ check: 'state-tool', passed: true, updates: state.length, workerId: gpu })
  } finally { db.close() }
  await writeFile(join(root, 'result.private.json'), JSON.stringify({ status: 'passed', runtime: '0.2.0-rc.2', archive, results, existingProfilesChanged: false }, null, 2))
  console.log(`Live integration passed. Private evidence: ${root}`)
} catch (error) {
  await writeFile(join(root, 'result.private.json'), JSON.stringify({ status: 'failed', results, error: error.message }, null, 2))
  throw error
}

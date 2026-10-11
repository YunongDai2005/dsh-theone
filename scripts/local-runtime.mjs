import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { spawnSync, spawn } from 'node:child_process'

export const root = fileURLToPath(new URL('../',import.meta.url))
if (existsSync(join(root,'.env'))) process.loadEnvFile(join(root,'.env'))
export const localRoot = process.env.THEONE_LOCAL_ROOT || join(homedir(),'.dsh-theone')
export const home = join(localRoot,'home')
const data = join(localRoot,'data')
mkdirSync(data,{recursive:true})
export const env = {...process.env,DSH_HOME:home,
  THEONE_DATABASE_PATH:process.env.THEONE_DATABASE_PATH || join(data,'contexts.db'),
  THEONE_ROUTER_MODE:process.env.THEONE_ROUTER_MODE || 'llm',
  DEEPSEEK_API_KEY:process.env.DEEPSEEK_API_KEY || process.env.THEONE_ROUTER_API_KEY,
}
const cli = process.env.DSH_BIN || 'dsh'
const prefix = cli.endsWith('.js') || cli.endsWith('.mjs') ? [cli] : []
const command = prefix.length ? process.execPath : cli
export function run(args) {
  const result = spawnSync(command,[...prefix,...args],{cwd:root,env,stdio:'inherit'})
  if (result.error) throw new Error('无法启动 DSH，请先安装 @deepseek-ai/dsh@0.2.0-rc.2，或设置 DSH_BIN。')
  if (result.status !== 0) throw new Error(`DSH 命令失败（${result.status}）`)
}
export function checkRuntime() {
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('TheOne 需要 Node.js 24 或更新版本。')
  const version = spawnSync(command,[...prefix,'--version'],{cwd:root,env,encoding:'utf8'})
  if (version.error || !/^0\.2\.0-rc\.2\s*$/.test(version.stdout.trim())) throw new Error('需要 DSH 0.2.0-rc.2；运行 npm install -g @deepseek-ai/dsh@0.2.0-rc.2。')
}
export function start(args) {
  const child = spawn(command,[...prefix,...args],{cwd:root,env,stdio:'inherit'})
  for (const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>child.kill(signal))
  child.on('error',()=>{console.error('DSH 启动失败');process.exitCode=1})
  child.on('exit',code=>{process.exitCode=code??0})
}

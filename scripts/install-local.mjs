import { existsSync } from 'node:fs'
import { mkdir,readFile,copyFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { packPlugin } from './pack-plugin.mjs'
import { home,localRoot,run,checkRuntime } from './local-runtime.mjs'

checkRuntime()
const packed = await packPlugin()
// A distinct source URL makes pnpm re-read same-version development builds.
const hash = createHash('sha256').update(await readFile(packed.archive)).digest('hex').slice(0,16)
const packageDirectory = join(localRoot,'packages')
await mkdir(packageDirectory,{recursive:true})
const installArchive = join(packageDirectory,packed.filename.replace('.tgz',`-${hash}.tgz`))
await copyFile(packed.archive,installArchive)
if (!existsSync(join(home,'profiles','theone','package.json'))) run(['--profile','theone','--from-default-profile','web','--help'])
run(['plugin','--profile','theone','add',installArchive,'--ignore-scripts'])
console.log('TheOne 已安装到独立的本地 Web profile。')
console.log('配置 .env 后运行 npm run start:local。')
console.log(`profile 和数据保存在 ${localRoot}。`)

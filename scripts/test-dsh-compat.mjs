import { execFileSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const archive = join(root, '.dsh-test', `dsh-theone-${version}.tgz`)
const host = await mkdtemp(join(tmpdir(), 'theone-host-compat-'))
try {
  for (const file of ['fixtures/contexts.json', 'tests/harness.ts', 'tests/mirror.test.ts', 'tests/compat/tool-admission.test.mjs']) {
    await mkdir(dirname(join(host, file)), { recursive: true })
    await cp(join(root, file), join(host, file))
  }
  await cp(join(root, 'tests/compat/dsh-0.2.2-rc.1.json'), join(host, 'package.json'))
  // Point the shared harness's source entry at the actual plugin installed by npm.
  await mkdir(join(host, 'src'))
  await writeFile(join(host, 'src/index.ts'), "export { default } from 'dsh-theone'\n")
  const npmCli = process.env.npm_execpath ?? (process.platform === 'win32'
    ? join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js') : undefined)
  const install = ['install', '--ignore-scripts', '--no-audit', '--no-fund', archive]
  const options = { cwd: host, stdio: 'inherit' }
  execFileSync(npmCli ? process.execPath : 'npm', npmCli ? [npmCli, ...install] : install, options)
  execFileSync(process.execPath, ['--import', 'tsx', '--test', 'tests/mirror.test.ts', 'tests/compat/tool-admission.test.mjs'], options)
} finally {
  await rm(host, { recursive: true, force: true })
}

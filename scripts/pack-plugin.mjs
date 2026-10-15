import { mkdir, mkdtemp, cp, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const root = fileURLToPath(new URL('../', import.meta.url))
const publicFiles = ['package.json', 'cordis.patch.yml', 'README.md', 'README.zh.md', 'docs/plugin-v0.1.md', 'docs/plugin-v0.1.zh.md', 'docs/plugin-v0.2.md', 'docs/plugin-v0.2.zh.md', 'docs/persistent-work.md']

export async function packPlugin(target = join(root, '.dsh-test')) {
  await mkdir(target, { recursive: true })
  const stage = await mkdtemp(join(tmpdir(), 'theone-package-'))
  try {
    // npm implicitly includes all Readme.* files even with a files allowlist.
    // Stage the deliverable so the user's original Readme.txt stays out of the archive.
    for (const path of [...publicFiles, 'dist']) {
      const destination = join(stage, path)
      if (path.startsWith('docs/')) await mkdir(join(stage, 'docs'), { recursive: true })
      await cp(join(root, path), destination, { recursive: true })
    }
    const env = { ...process.env }
    delete env.THEONE_ROUTER_API_KEY
    delete env.DEEPSEEK_API_KEY
    // npm.cmd is a shell shim on Windows; run npm's JS entry directly without a shell.
    const npmCli = env.npm_execpath ?? (process.platform === 'win32' ? join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js') : undefined)
    const args = ['pack', '--json', '--pack-destination', target]
    const { stdout } = await promisify(execFile)(npmCli ? process.execPath : 'npm', npmCli ? [npmCli, ...args] : args, { cwd: stage, env })
    const [result] = JSON.parse(stdout)
    const forbidden = result.files.filter(file => !publicFiles.includes(file.path) && !/^dist\/[\w-]+\.(?:js|d\.ts)$/.test(file.path))
    if (forbidden.length) throw new Error('Unexpected private/test data in plugin archive')
    return { ...result, archive: join(target, result.filename) }
  } finally { await rm(stage, { recursive: true, force: true }) }
}

if (import.meta.main) {
  const result = await packPlugin()
  console.log(`Plugin archive: ${result.archive}`)
  console.log(`Files: ${result.entryCount}; unpacked bytes: ${result.unpackedSize}`)
}

export const REPOSITORY = 'YunongDai2005/dsh-theone'
export const PACKAGE_NAME = 'dsh-theone'

/** Where this copy was installed from, which decides where its updates come from. */
export type UpdateSource = 'github' | 'npm' | 'other'

export interface UpdateStatus {
  current: string
  latest?: string
  /** A newer version exists. */
  available: boolean
  /** It can be installed from here (otherwise reinstall by hand). */
  installable: boolean
  source: UpdateSource
  /** installing → restart (installed, applies after DSH restarts) or failed. */
  state?: 'installing' | 'restart' | 'failed'
  error?: string
}

/** The DSH plugin manager's install call, as TheOne uses it. */
export interface PluginInstaller {
  installBundle(spec: string, options?: { enabled?: boolean }): Promise<{ application: string; error?: { code?: string; message?: string } | unknown }>
}

/** Compare dotted versions numerically; a pre-release sorts before its release. */
export function compareVersions(a: string, b: string): number {
  const parse = (value: string) => {
    const [core, pre] = value.trim().replace(/^v/, '').split('-', 2)
    return { parts: core.split('.').map(part => Number.parseInt(part, 10) || 0), pre }
  }
  const x = parse(a), y = parse(b)
  for (let index = 0; index < Math.max(x.parts.length, y.parts.length); index++) {
    const difference = (x.parts[index] ?? 0) - (y.parts[index] ?? 0)
    if (difference) return Math.sign(difference)
  }
  if (x.pre === y.pre) return 0
  return x.pre === undefined ? 1 : y.pre === undefined ? -1 : x.pre < y.pre ? -1 : 1
}

/** Read the dependency spec DSH saved for this plugin: GitHub, npm, or something else (a local path, a tarball). */
export function installSource(spec: string | undefined): UpdateSource {
  if (!spec) return 'other'
  if (spec.toLowerCase().includes(REPOSITORY.toLowerCase())) return 'github'
  if (/^(?:npm:dsh-theone@)?[\^~>=<\s]*\d|^latest$|^\*$/.test(spec)) return 'npm'
  return 'other'
}

const HOUR = 3600000

/** Checks for a newer TheOne and installs it through DSH's own plugin manager. */
export class Updater {
  private checked?: { at: number; latest?: string; sha?: string; error?: string }
  private state?: UpdateStatus['state']
  private error?: string
  private pending?: Promise<void>

  constructor(readonly current: string, private readonly spec: () => string | undefined,
    private readonly fetcher: typeof fetch = fetch, private readonly now: () => number = Date.now) {}

  get source(): UpdateSource { return installSource(this.spec()) }

  /** The latest known status; checks again at most every six hours (or now, when forced). */
  async status(force = false): Promise<UpdateStatus> {
    const age = this.checked ? this.now() - this.checked.at : Infinity
    if (this.state !== 'installing' && (force || age > (this.checked?.error ? HOUR / 2 : 6 * HOUR))) {
      this.pending ??= this.check().finally(() => { this.pending = undefined })
      await this.pending
    }
    return this.snapshot()
  }

  /** Install the newer version. It is loaded the next time DSH starts. */
  async install(installer: PluginInstaller | undefined): Promise<UpdateStatus> {
    const status = await this.status()
    if (!status.available || !status.installable || !installer || this.state === 'installing' || this.state === 'restart') return this.snapshot()
    const spec = this.source === 'github' ? `github:${REPOSITORY}#${this.checked!.sha}` : `${PACKAGE_NAME}@${this.checked!.latest}`
    this.state = 'installing'; this.error = undefined
    try {
      const result = await installer.installBundle(spec, { enabled: true })
      if (result.application === 'applied' || result.application === 'restart-required') this.state = 'restart'
      else {
        this.state = 'failed'
        const error = result.error as { code?: string; message?: string } | undefined
        this.error = String(error?.code ?? error?.message ?? result.application).slice(0, 120)
      }
    } catch (error) {
      this.state = 'failed'
      this.error = (error instanceof Error ? error.message : String(error)).slice(0, 120)
    }
    return this.snapshot()
  }

  private snapshot(): UpdateStatus {
    const latest = this.checked?.latest
    const source = this.source
    const available = !!latest && compareVersions(latest, this.current) > 0
    return { current: this.current, ...(latest ? { latest } : {}), available, source,
      installable: available && (source === 'npm' || (source === 'github' && !!this.checked?.sha)),
      ...(this.state ? { state: this.state } : {}), ...(this.error ?? this.checked?.error ? { error: this.error ?? this.checked?.error } : {}) }
  }

  private async check(): Promise<void> {
    const signal = AbortSignal.timeout(10000)
    try {
      if (this.source === 'npm') {
        const response = await this.fetcher(`https://registry.npmjs.org/${PACKAGE_NAME}/latest`, { signal })
        if (!response.ok) throw new Error(`npm ${response.status}`)
        this.checked = { at: this.now(), latest: String(((await response.json()) as { version?: unknown }).version ?? '') || undefined }
        return
      }
      // A GitHub install updates to the exact commit whose version was read.
      const commit = await this.fetcher(`https://api.github.com/repos/${REPOSITORY}/commits/main`, { signal, headers: { accept: 'application/vnd.github.sha' } })
      if (!commit.ok) throw new Error(`GitHub ${commit.status}`)
      const sha = (await commit.text()).trim()
      if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('GitHub returned no commit')
      const manifest = await this.fetcher(`https://raw.githubusercontent.com/${REPOSITORY}/${sha}/package.json`, { signal })
      if (!manifest.ok) throw new Error(`GitHub ${manifest.status}`)
      const latest = String(((await manifest.json()) as { version?: unknown }).version ?? '') || undefined
      this.checked = { at: this.now(), latest, sha }
    } catch (error) {
      // Offline or rate-limited: keep what was known and try again later.
      this.checked = { ...this.checked, at: this.now(), error: (error instanceof Error ? error.message : String(error)).slice(0, 120) }
    }
  }
}

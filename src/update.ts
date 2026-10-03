import { readFileSync, renameSync, writeFileSync } from 'node:fs'

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
  /** installing → reloading (TheOne restarts itself; DSH keeps running), restart (applies after DSH restarts) or failed. */
  state?: 'installing' | 'reloading' | 'restart' | 'failed'
  /** Why it failed: MINIMUM_RELEASE_AGE, NETWORK, or the plugin manager's own code. */
  error?: string
  /** A newer npm version that pnpm will accept only once it is a day old, and when that is. */
  waiting?: { version: string; readyAt: number }
  /** TheOne is exempt from that rule in this DSH profile, so fresh versions install right away. */
  exempt?: boolean
  /** Whether this profile's pnpm settings can be edited to grant that exemption. */
  canExempt?: boolean
}

const EXCLUDE_KEY = 'minimumReleaseAgeExclude'
const unquote = (value: string) => value.trim().replace(/^['"]|['"]$/g, '')

/** The packages a pnpm-workspace.yaml exempts from the release-age rule (block or flow list). */
export function releaseAgeExemptions(text: string): string[] {
  const lines = text.split(/\r?\n/)
  const index = lines.findIndex(line => line.startsWith(`${EXCLUDE_KEY}:`))
  if (index < 0) return []
  const inline = lines[index].slice(EXCLUDE_KEY.length + 1).trim()
  if (inline.startsWith('[')) return inline.replace(/^\[|\]$/g, '').split(',').map(unquote).filter(Boolean)
  const items: string[] = []
  for (let line = index + 1; line < lines.length && /^\s+-/.test(lines[line]); line++) items.push(unquote(lines[line].replace(/^\s+-\s*/, '')))
  return items
}

/**
 * The same pnpm-workspace.yaml with `name` added to the release-age exemptions, every other line
 * kept as it was. Throws for a layout it does not recognise rather than guess.
 */
export function withReleaseAgeExemption(text: string, name = PACKAGE_NAME): string {
  if (releaseAgeExemptions(text).includes(name)) return text
  const newline = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(/\r?\n/)
  const index = lines.findIndex(line => line.startsWith(`${EXCLUDE_KEY}:`))
  if (index < 0) return `${text}${text && !/\r?\n$/.test(text) ? newline : ''}${EXCLUDE_KEY}:${newline}  - ${name}${newline}`
  const inline = lines[index].slice(EXCLUDE_KEY.length + 1).trim()
  if (inline.startsWith('[') && inline.endsWith(']')) {
    lines[index] = `${EXCLUDE_KEY}: [${[...releaseAgeExemptions(text), name].map(item => JSON.stringify(item)).join(', ')}]`
    return lines.join(newline)
  }
  if (inline) throw new Error('UNRECOGNISED_WORKSPACE')
  let end = index + 1
  while (end < lines.length && /^\s+-/.test(lines[end])) end++
  const indent = end > index + 1 ? lines[index + 1].match(/^\s+/)![0] : '  '
  lines.splice(end, 0, `${indent}- ${name}`)
  return lines.join(newline)
}

/**
 * pnpm, which DSH installs plugins with, refuses npm versions published less than a day ago
 * (minimumReleaseAge, a supply-chain safeguard). Updates from npm wait until then.
 */
export const RELEASE_AGE_MS = 24 * 3600000

/** The DSH plugin manager's install call, as TheOne uses it. */
export interface PluginInstaller {
  installBundle(spec: string, options?: { enabled?: boolean }): Promise<{ application: string; bundle?: string; error?: { code?: string; message?: string } | unknown; packageResult?: { output?: string } }>
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
  private checked?: { at: number; latest?: string; sha?: string; error?: string; waiting?: UpdateStatus['waiting'] }
  private state?: UpdateStatus['state']
  private error?: string
  private pending?: Promise<void>

  /**
   * @param workspace - this DSH profile's pnpm-workspace.yaml, where pnpm reads the release-age
   * exemptions; undefined when the profile is unknown.
   */
  constructor(readonly current: string, private readonly spec: () => string | undefined,
    private readonly fetcher: typeof fetch = fetch, private readonly now: () => number = Date.now,
    private readonly workspace: () => string | undefined = () => undefined) {}

  /** Whether pnpm in this profile already lets TheOne install versions under a day old. */
  get exempt(): boolean {
    const file = this.workspace()
    if (!file) return false
    try { return releaseAgeExemptions(readFileSync(file, 'utf8')).includes(PACKAGE_NAME) } catch { return false }
  }

  /** Exempt TheOne, and only TheOne, from pnpm's release-age rule in this profile. */
  allowFresh(): void {
    const file = this.workspace()
    if (!file) throw new Error('NO_PROFILE')
    let text = ''
    try { text = readFileSync(file, 'utf8') } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    const next = withReleaseAgeExemption(text)
    if (next === text) return
    writeFileSync(`${file}.theone-tmp`, next, { mode: 0o600 })
    renameSync(`${file}.theone-tmp`, file)
    if (this.state === 'failed') { this.state = undefined; this.error = undefined }
  }

  get source(): UpdateSource { return installSource(this.spec()) }

  /** The latest known status; checks again at most every six hours (or now, when forced). */
  async status(force = false): Promise<UpdateStatus> {
    const age = this.checked ? this.now() - this.checked.at : Infinity
    // A version waiting out pnpm's release age is looked at again as soon as it qualifies.
    const due = !!this.checked?.waiting && this.now() >= this.checked.waiting.readyAt
    if (this.state !== 'installing' && (force || due || age > (this.checked?.error ? HOUR / 2 : 6 * HOUR))) {
      this.pending ??= this.check().finally(() => { this.pending = undefined })
      await this.pending
    }
    return this.snapshot()
  }

  /**
   * Install the newer version. With `reload`, TheOne then restarts itself so the new version runs
   * without restarting DSH; otherwise it is loaded the next time DSH starts.
   */
  async install(installer: PluginInstaller | undefined, reload?: (bundle: string) => void): Promise<UpdateStatus> {
    const status = await this.status()
    if (!status.available || !status.installable || !installer || this.state === 'installing' || this.state === 'reloading' || this.state === 'restart') return this.snapshot()
    const spec = this.source === 'github' ? `github:${REPOSITORY}#${this.checked!.sha}` : `${PACKAGE_NAME}@${status.latest}`
    this.state = 'installing'; this.error = undefined
    try {
      const result = await installer.installBundle(spec, { enabled: true })
      if (result.application === 'applied' || result.application === 'restart-required') {
        this.state = reload ? 'reloading' : 'restart'
        reload?.(result.bundle ?? PACKAGE_NAME)
      } else {
        this.state = 'failed'
        const error = result.error as { code?: string; message?: string } | undefined
        // pnpm's own reasons are clearer than the plugin manager's generic failure.
        const output = `${result.packageResult?.output ?? ''}\n${error?.message ?? ''}`
        this.error = /MINIMUM_RELEASE_AGE/.test(output) ? 'MINIMUM_RELEASE_AGE'
          : /UND_ERR|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ERR_PNPM_META_FETCH_FAIL|network/i.test(output) ? 'NETWORK'
          : String(error?.code ?? error?.message ?? result.application).slice(0, 120)
      }
    } catch (error) {
      this.state = 'failed'
      this.error = (error instanceof Error ? error.message : String(error)).slice(0, 120)
    }
    return this.snapshot()
  }

  private snapshot(): UpdateStatus {
    const exempt = this.source === 'npm' && this.exempt
    // Exempt from the release-age rule, the newest version is ready as soon as it is published.
    const fresh = this.checked?.waiting && compareVersions(this.checked.waiting.version, this.current) > 0 ? this.checked.waiting : undefined
    const latest = exempt && fresh ? fresh.version : this.checked?.latest
    const source = this.source
    const available = !!latest && compareVersions(latest, this.current) > 0
    const waiting = fresh && !exempt ? { waiting: fresh } : {}
    return { current: this.current, ...(latest ? { latest } : {}), available, source, ...waiting,
      ...(source === 'npm' ? { exempt, canExempt: !!this.workspace() } : {}),
      installable: available && (source === 'npm' || (source === 'github' && !!this.checked?.sha)),
      ...(this.state ? { state: this.state } : {}), ...(this.error ?? this.checked?.error ? { error: this.error ?? this.checked?.error } : {}) }
  }

  private async check(): Promise<void> {
    const signal = AbortSignal.timeout(10000)
    try {
      if (this.source === 'npm') {
        const response = await this.fetcher(`https://registry.npmjs.org/${PACKAGE_NAME}`, { signal })
        if (!response.ok) throw new Error(`npm ${response.status}`)
        const packument = await response.json() as { versions?: Record<string, unknown>; time?: Record<string, string> }
        // Offer the newest release pnpm will accept now; a newer one waits until it is a day old.
        const now = this.now()
        const releases = Object.keys(packument.versions ?? {}).filter(version => /^\d+\.\d+\.\d+$/.test(version))
          .map(version => ({ version, at: Date.parse(packument.time?.[version] ?? '') }))
          .filter(release => Number.isFinite(release.at)).sort((a, b) => compareVersions(b.version, a.version))
        const ready = releases.find(release => now - release.at >= RELEASE_AGE_MS)
        const newest = releases[0]
        this.checked = { at: now, ...(ready ? { latest: ready.version } : {}),
          ...(newest && newest !== ready ? { waiting: { version: newest.version, readyAt: newest.at + RELEASE_AGE_MS } } : {}) }
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

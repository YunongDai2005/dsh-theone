import { compareVersions } from './update.ts'

/** Where TheOne's maintainer publishes notices: a static JSON file, read with a plain GET. */
export const NOTICE_URL = 'https://yulid.org/theone/notice.json'

/** Text in each interface language; the reader's language is chosen in the client. */
export interface LocalizedText { zh?: string; en?: string }

/** One notice as the client shows it. */
export interface Notice {
  id: string
  /** `important` opens a dialog once; `info` shows a strip under the main chat input. */
  level: 'info' | 'important'
  title: LocalizedText
  body: LocalizedText
  /** An https page to read more; opened only when the reader clicks it. */
  link?: string
}

const HOUR = 3600000
const text = (value: unknown, max: number): LocalizedText | undefined => {
  if (typeof value === 'string') return value.trim() ? { zh: value.trim().slice(0, max), en: value.trim().slice(0, max) } : undefined
  if (!value || typeof value !== 'object') return undefined
  const row = value as Record<string, unknown>
  const pick = (key: 'zh' | 'en') => typeof row[key] === 'string' && (row[key] as string).trim() ? { [key]: (row[key] as string).trim().slice(0, max) } : {}
  const result = { ...pick('zh'), ...pick('en') }
  return Object.keys(result).length ? result : undefined
}

/**
 * Whether `version` falls within a range such as "<0.3.16", ">=0.3.10", "0.3.12", "*", or several
 * of these separated by spaces (all must hold). An unreadable range matches nothing.
 */
export function versionMatches(range: unknown, version: string): boolean {
  if (range === undefined || range === null || range === '*' || range === '') return true
  if (typeof range !== 'string') return false
  return range.trim().split(/\s+/).every(part => {
    const match = /^(<=|>=|<|>|=)?v?(\d+\.\d+\.\d+)$/.exec(part)
    if (!match) return false
    const order = compareVersions(version, match[2])
    return { '<': order < 0, '<=': order <= 0, '>': order > 0, '>=': order >= 0, '=': order === 0 }[match[1] ?? '=']!
  })
}

/**
 * The notices in a published file that apply to this version now, at most five. Anything that does
 * not fit the format is skipped rather than shown; text is plain, links must be https.
 */
export function applicableNotices(file: unknown, version: string, now = Date.now()): Notice[] {
  const list = file && typeof file === 'object' && Array.isArray((file as { notices?: unknown }).notices) ? (file as { notices: unknown[] }).notices : []
  const result: Notice[] = []
  for (const item of list.slice(0, 20)) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    if (typeof row.id !== 'string' || !/^[\w.-]{1,64}$/.test(row.id) || result.some(notice => notice.id === row.id)) continue
    const title = text(row.title, 80), body = text(row.body, 600)
    if (!title || !body || !versionMatches(row.versions, version)) continue
    const time = (value: unknown) => typeof value === 'string' ? Date.parse(value) : NaN
    if (Number.isFinite(time(row.from)) && now < time(row.from)) continue
    if (Number.isFinite(time(row.until)) && now > time(row.until)) continue
    let link: string | undefined
    if (typeof row.link === 'string') {
      try { const url = new URL(row.link); if (url.protocol === 'https:' && row.link.length <= 300) link = url.href } catch { /* Not a link. */ }
    }
    result.push({ id: row.id, level: row.level === 'important' ? 'important' : 'info', title, body, ...(link ? { link } : {}) })
    if (result.length === 5) break
  }
  return result
}

/** Reads the notice file at most every three hours; a failure simply means no notices. */
export class NoticeBoard {
  private cache?: { at: number; file?: unknown }
  private pending?: Promise<void>

  constructor(private readonly version: string, private readonly url = NOTICE_URL,
    private readonly fetcher: typeof fetch = fetch, private readonly now: () => number = Date.now) {}

  async notices(): Promise<Notice[]> {
    if (!this.cache || this.now() - this.cache.at > 3 * HOUR) {
      this.pending ??= this.read().finally(() => { this.pending = undefined })
      await this.pending
    }
    return applicableNotices(this.cache?.file, this.version, this.now())
  }

  private async read(): Promise<void> {
    try {
      // A plain GET: nothing about the reader or their conversations is sent.
      const response = await this.fetcher(this.url, { signal: AbortSignal.timeout(8000), headers: { accept: 'application/json' } })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const body = await response.text()
      if (body.length > 64000) throw new Error('Notice file too large')
      this.cache = { at: this.now(), file: JSON.parse(body) }
    } catch {
      // Try again in half an hour, keeping what was read before.
      this.cache = { at: this.now() - 2.5 * HOUR, file: this.cache?.file }
    }
  }
}

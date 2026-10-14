import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { LinkScope } from './linkage.ts'
import type { EditableSettings } from './settings-types.ts'
import type { ContextDescriptor } from './types.ts'

/** The part of DSH's workspace registry TheOne uses to keep its own sessions out of sight while off. */
export interface OwnSessionArchive {
  readonly archivedSessionIds: readonly string[]
  archiveSession(sessionId: SessionId, options?: { stopActivity?: boolean }): Promise<void>
  unarchiveSession(sessionId: SessionId): Promise<void>
}

/** The part of DSH's agent preset registry that gives a session its tools. */
export interface AgentPresets {
  resolve(id?: string): Promise<{ id: string }>
  mount(ctx: Context, id?: string): Promise<{ id: string }>
  composedPreset(ctx: Context): string | undefined
}

export interface Config {
  databasePath?: string
  contextsPath?: string
  gatewayKey: string
  workerProvider?: string
  workerModel?: string
  maxDescriptorChars: number
  maxResponseChars: number
  routerMode?: 'rules' | 'llm'
  /** @deprecated The direct DeepSeek router was removed; routing always uses DSH. Accepted and ignored. */
  routerTransport?: 'dsh' | 'legacy'
  historyCatalog?: boolean
  catalogIntervalMs?: number
  routerBaseUrl?: string
  routerModel?: string
  routerApiKeyEnv?: string
  linkScope?: LinkScope
  routeNotice?: 'hidden' | 'switch' | 'all'
  /** Show notices the maintainer publishes (read from a static file; nothing is sent). */
  notices?: boolean
  /** Experimental: topics share confirmed facts (a figure, a decision) with evidence and versions. */
  factLinks?: boolean
  /** With factLinks: after each turn, a small model call proposes facts the Worker did not record. */
  factExtraction?: boolean
  /** A routing card per topic, written in the background after its first replies; on unless turned off (tests). */
  topicCards?: boolean
  /** Where notices are read from; for testing. */
  noticeUrl?: string
  /** Where problem reports are sent when the user presses Send; "off" leaves only copy and email. For testing. */
  feedbackUrl?: string
}

/** Saved settings as service configuration; an unset choice falls back to following DSH. */
export function settingsConfig(values: EditableSettings): Partial<Config> {
  return { ...values, workerProvider: values.workerProvider ?? undefined, workerModel: values.workerModel ?? undefined, contextsPath: values.contextsPath ?? undefined }
}

/**
 * Switch an installed bundle off and on so DSH loads its new version. This disposes the running
 * TheOne, so it runs after the current request has answered and outlives this instance.
 */
export function reloadBundle(manager: { setBundleEnabled?(name: string, enabled: boolean): Promise<{ application: string }> }, bundle: string): void {
  setTimeout(() => {
    void (async () => {
      const off = await manager.setBundleEnabled!(bundle, false)
      if (off.application === 'failed' || off.application === 'cancelled') return
      await manager.setBundleEnabled!(bundle, true)
    })().catch(error => console.warn('TheOne could not reload itself after updating; restart DSH to apply the update.', error))
  }, 300)
}

export function readOwnVersion(): string {
  try { return String((JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version?: unknown }).version ?? '0.0.0') }
  catch { return '0.0.0' }
}

/** DSH's own version, as far as its packages say; undefined when it cannot be read. */
export function readDshVersion(): string | undefined {
  try { return String((createRequire(import.meta.url)('@deepseek-ai/dsh-agent/package.json') as { version?: unknown }).version ?? '') || undefined }
  catch { return undefined }
}

export function readDescriptors(path: string): ContextDescriptor[] {
  const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (!Array.isArray(value)) throw new Error('contextsPath must contain a JSON array')
  const ids = new Set<string>()
  for (const item of value) {
    if (typeof item !== 'object' || item === null ||
      !['id', 'title', 'summary', 'lastState'].every(key => typeof item[key] === 'string' && item[key].length > 0) ||
      !['entities', 'keywords'].every(key => Array.isArray(item[key]) && item[key].every((term: unknown) => typeof term === 'string' && term.length > 0)) || ids.has(item.id)) {
      throw new Error('Invalid or duplicate Context descriptor')
    }
    ids.add(item.id)
  }
  return value as ContextDescriptor[]
}

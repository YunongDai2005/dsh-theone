import { EDITABLE_SETTINGS_KEYS, RETIRED_SETTINGS_KEYS, SETTINGS_DEFAULTS, type EditableSettings } from './settings-types.ts'

/**
 * Validate the entire editable form before committing any settings. `fallback` fills keys added
 * after the form was saved whose default comes from the deployment (e.g. the catalog file).
 */
export function validateSettings(value: unknown, fallback: Partial<EditableSettings> = {}): EditableSettings {
  const fail = (): never => { throw new Error('INVALID_SETTINGS') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail()
  const row: Record<string, unknown> = { ...SETTINGS_DEFAULTS, contextsPath: null, ...fallback, ...value as Record<string, unknown> }
  for (const key of RETIRED_SETTINGS_KEYS) delete row[key]
  if (Object.keys(row).length !== EDITABLE_SETTINGS_KEYS.length || Object.keys(row).some(k => !EDITABLE_SETTINGS_KEYS.includes(k as typeof EDITABLE_SETTINGS_KEYS[number]))) return fail()
  if (!['off', 'workspace', 'auto'].includes(row.linkScope as string) || !['hidden', 'switch', 'all'].includes(row.routeNotice as string)) return fail()
  const text = (key: string, max: number) => {
    const v = row[key]
    if (typeof v !== 'string' || !v.trim() || v.length > max || /[\x00-\x1f\x7f]|\bsk-[A-Za-z0-9_-]{16,}/i.test(v)) return fail()
    return v.trim()
  }
  const number = (key: string, min: number, max: number) => {
    const v = row[key]
    if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min || v > max) return fail()
    return v
  }
  if (typeof row.historyCatalog !== 'boolean' || typeof row.routerMode !== 'string' || !['llm', 'rules'].includes(row.routerMode)) return fail()
  const workerProvider = row.workerProvider === null ? null : text('workerProvider', 256)
  const workerModel = row.workerModel === null ? null : text('workerModel', 256)
  if ((workerProvider === null) !== (workerModel === null) || workerProvider === 'theone') return fail()
  const contextsPath = row.contextsPath === null ? null : text('contextsPath', 4096)
  return { workerProvider, workerModel, routerMode: row.routerMode as EditableSettings['routerMode'], historyCatalog: row.historyCatalog,
    catalogIntervalMs: number('catalogIntervalMs', 10000, 86400000), maxDescriptorChars: number('maxDescriptorChars', 128, 1000000),
    maxResponseChars: number('maxResponseChars', 128, 10000000),
    linkScope: row.linkScope as EditableSettings['linkScope'], routeNotice: row.routeNotice as EditableSettings['routeNotice'], contextsPath }
}

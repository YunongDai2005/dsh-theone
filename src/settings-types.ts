/** Public configuration projection. Credentials are never part of this response. */
export interface SettingsSnapshot {
  values: {
    historyCatalog: boolean; catalogIntervalMs: number
    databasePath: string; contextsPath: string | null; gatewayKey: string
    workerProvider: string | null; workerModel: string | null
    maxDescriptorChars: number; maxResponseChars: number
    routerMode: 'rules' | 'llm'
    linkScope: 'off' | 'workspace' | 'auto'; routeNotice: 'hidden' | 'switch' | 'all'
    notices: boolean
  }
  model: { provider: string; model: string; contextWindow?: number; defaultMaxTokens?: number } | null
  /** Every model DSH currently offers, except TheOne itself. */
  models: { provider: string; id: string; name: string }[]
  modelUnavailable: boolean
  savedValues: EditableSettings
  revision: number
  /** Saved settings that apply only after DSH restarts; everything else applies when saved. */
  restartRequired: boolean
}

export const EDITABLE_SETTINGS_KEYS = ['workerProvider', 'workerModel', 'routerMode', 'historyCatalog',
  'catalogIntervalMs', 'maxDescriptorChars', 'maxResponseChars', 'linkScope', 'routeNotice', 'contextsPath', 'notices'] as const
/** The background catalog is started once; these take effect after DSH restarts. */
export const RESTART_SETTINGS_KEYS = ['historyCatalog', 'catalogIntervalMs'] as const
/** Settings of the removed direct router; forms saved by older versions may still carry them. */
export const RETIRED_SETTINGS_KEYS = ['routerTransport', 'routerBaseUrl', 'routerModel', 'routerApiKeyEnv'] as const
/** Added after the first release; settings saved before them take their defaults. */
export const SETTINGS_DEFAULTS = { linkScope: 'auto', routeNotice: 'switch', notices: true } as const
export type EditableSettings = Pick<SettingsSnapshot['values'], typeof EDITABLE_SETTINGS_KEYS[number]>

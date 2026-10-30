export const EDITABLE_SETTINGS_KEYS = ['workerProvider', 'workerModel', 'routerMode', 'historyCatalog',
    'catalogIntervalMs', 'maxDescriptorChars', 'maxResponseChars', 'linkScope', 'routeNotice', 'contextsPath', 'notices', 'hideTopicSessions', 'factLinks', 'factExtraction', 'persistentWork'];
/** The background catalog is started once; these take effect after DSH restarts. */
export const RESTART_SETTINGS_KEYS = ['historyCatalog', 'catalogIntervalMs', 'factLinks', 'factExtraction', 'persistentWork'];
/** Settings of the removed direct router; forms saved by older versions may still carry them. */
export const RETIRED_SETTINGS_KEYS = ['routerTransport', 'routerBaseUrl', 'routerModel', 'routerApiKeyEnv'];
/** Added after the first release; settings saved before them take their defaults. */
export const SETTINGS_DEFAULTS = { linkScope: 'auto', routeNotice: 'hidden', notices: true, hideTopicSessions: false, factLinks: false, factExtraction: false, persistentWork: false };

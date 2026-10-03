/** Public configuration projection. Credentials are never part of this response. */
export interface SettingsSnapshot {
    values: {
        historyCatalog: boolean;
        catalogIntervalMs: number;
        databasePath: string;
        contextsPath: string | null;
        gatewayKey: string;
        workerProvider: string | null;
        workerModel: string | null;
        maxDescriptorChars: number;
        maxResponseChars: number;
        routerMode: 'rules' | 'llm';
        routerTransport: 'dsh' | 'legacy';
        routerBaseUrl: string;
        routerModel: string;
        routerApiKeyEnv: string;
        linkScope: 'off' | 'workspace' | 'auto';
        routeNotice: 'hidden' | 'switch' | 'all';
    };
    model: {
        provider: string;
        model: string;
        contextWindow?: number;
        defaultMaxTokens?: number;
    } | null;
    modelUnavailable: boolean;
    savedValues: EditableSettings;
    revision: number;
    restartRequired: boolean;
}
export declare const EDITABLE_SETTINGS_KEYS: readonly ["workerProvider", "workerModel", "routerMode", "routerTransport", "historyCatalog", "catalogIntervalMs", "maxDescriptorChars", "maxResponseChars", "routerBaseUrl", "routerModel", "routerApiKeyEnv", "linkScope", "routeNotice"];
/** Added after the first release; settings saved before them take their defaults. */
export declare const SETTINGS_DEFAULTS: {
    readonly linkScope: "auto";
    readonly routeNotice: "switch";
};
export type EditableSettings = Pick<SettingsSnapshot['values'], typeof EDITABLE_SETTINGS_KEYS[number]>;

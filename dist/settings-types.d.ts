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
        linkScope: 'off' | 'workspace' | 'auto';
        routeNotice: 'hidden' | 'switch' | 'all';
        notices: boolean;
    };
    model: {
        provider: string;
        model: string;
        contextWindow?: number;
        defaultMaxTokens?: number;
    } | null;
    /** Every model DSH currently offers, except TheOne itself. */
    models: {
        provider: string;
        id: string;
        name: string;
    }[];
    modelUnavailable: boolean;
    savedValues: EditableSettings;
    revision: number;
    /** Saved settings that apply only after DSH restarts; everything else applies when saved. */
    restartRequired: boolean;
}
export declare const EDITABLE_SETTINGS_KEYS: readonly ["workerProvider", "workerModel", "routerMode", "historyCatalog", "catalogIntervalMs", "maxDescriptorChars", "maxResponseChars", "linkScope", "routeNotice", "contextsPath", "notices"];
/** The background catalog is started once; these take effect after DSH restarts. */
export declare const RESTART_SETTINGS_KEYS: readonly ["historyCatalog", "catalogIntervalMs"];
/** Settings of the removed direct router; forms saved by older versions may still carry them. */
export declare const RETIRED_SETTINGS_KEYS: readonly ["routerTransport", "routerBaseUrl", "routerModel", "routerApiKeyEnv"];
/** Added after the first release; settings saved before them take their defaults. */
export declare const SETTINGS_DEFAULTS: {
    readonly linkScope: "auto";
    readonly routeNotice: "switch";
    readonly notices: true;
};
export type EditableSettings = Pick<SettingsSnapshot['values'], typeof EDITABLE_SETTINGS_KEYS[number]>;

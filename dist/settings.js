import { EDITABLE_SETTINGS_KEYS } from "./settings-types.js";
/** Validate the entire editable form before committing any settings. */
export function validateSettings(value) {
    const fail = () => { throw new Error('INVALID_SETTINGS'); };
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return fail();
    const row = value;
    if (Object.keys(row).length !== EDITABLE_SETTINGS_KEYS.length || Object.keys(row).some(k => !EDITABLE_SETTINGS_KEYS.includes(k)))
        return fail();
    const text = (key, max) => {
        const v = row[key];
        if (typeof v !== 'string' || !v.trim() || v.length > max || /[\x00-\x1f\x7f]|\bsk-[A-Za-z0-9_-]{16,}/i.test(v))
            return fail();
        return v.trim();
    };
    const number = (key, min, max) => {
        const v = row[key];
        if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min || v > max)
            return fail();
        return v;
    };
    if (typeof row.historyCatalog !== 'boolean' || typeof row.routerMode !== 'string' || typeof row.routerTransport !== 'string' ||
        !['llm', 'rules'].includes(row.routerMode) || !['dsh', 'legacy'].includes(row.routerTransport))
        return fail();
    const workerProvider = row.workerProvider === null ? null : text('workerProvider', 256);
    const workerModel = row.workerModel === null ? null : text('workerModel', 256);
    if ((workerProvider === null) !== (workerModel === null) || workerProvider === 'theone')
        return fail();
    const routerBaseUrl = text('routerBaseUrl', 2048);
    let url;
    try {
        url = new URL(routerBaseUrl);
    }
    catch {
        return fail();
    }
    // The legacy router only sends its key over HTTPS; accepting http here would save a config it refuses at startup.
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
        return fail();
    const routerApiKeyEnv = text('routerApiKeyEnv', 128);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(routerApiKeyEnv))
        return fail();
    return { workerProvider, workerModel, routerMode: row.routerMode,
        routerTransport: row.routerTransport, historyCatalog: row.historyCatalog,
        catalogIntervalMs: number('catalogIntervalMs', 10000, 86400000), maxDescriptorChars: number('maxDescriptorChars', 128, 1000000),
        maxResponseChars: number('maxResponseChars', 128, 10000000), routerBaseUrl: url.toString(), routerModel: text('routerModel', 256), routerApiKeyEnv };
}

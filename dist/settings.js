import { EDITABLE_SETTINGS_KEYS, RETIRED_SETTINGS_KEYS, SETTINGS_DEFAULTS } from "./settings-types.js";
/**
 * Validate the entire editable form before committing any settings. `fallback` fills keys added
 * after the form was saved whose default comes from the deployment (e.g. the catalog file).
 */
export function validateSettings(value, fallback = {}) {
    const fail = () => { throw new Error('INVALID_SETTINGS'); };
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return fail();
    const row = { ...SETTINGS_DEFAULTS, contextsPath: null, ...fallback, ...value };
    for (const key of RETIRED_SETTINGS_KEYS)
        delete row[key];
    if (Object.keys(row).length !== EDITABLE_SETTINGS_KEYS.length || Object.keys(row).some(k => !EDITABLE_SETTINGS_KEYS.includes(k)))
        return fail();
    if (!['off', 'workspace', 'auto'].includes(row.linkScope) || !['hidden', 'switch', 'all'].includes(row.routeNotice))
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
    if (typeof row.historyCatalog !== 'boolean' || typeof row.routerMode !== 'string' || !['llm', 'rules'].includes(row.routerMode))
        return fail();
    const workerProvider = row.workerProvider === null ? null : text('workerProvider', 256);
    const workerModel = row.workerModel === null ? null : text('workerModel', 256);
    if ((workerProvider === null) !== (workerModel === null) || workerProvider === 'theone')
        return fail();
    const contextsPath = row.contextsPath === null ? null : text('contextsPath', 4096);
    if (typeof row.notices !== 'boolean' || typeof row.factLinks !== 'boolean' || typeof row.factExtraction !== 'boolean')
        return fail();
    return { workerProvider, workerModel, routerMode: row.routerMode, historyCatalog: row.historyCatalog,
        catalogIntervalMs: number('catalogIntervalMs', 10000, 86400000), maxDescriptorChars: number('maxDescriptorChars', 128, 1000000),
        maxResponseChars: number('maxResponseChars', 128, 10000000),
        linkScope: row.linkScope, routeNotice: row.routeNotice, contextsPath, notices: row.notices,
        factLinks: row.factLinks, factExtraction: row.factExtraction };
}

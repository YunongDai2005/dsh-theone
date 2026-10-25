import { existsSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
/** Canonical repository root, or workspace root when it is not a Git checkout. */
export function projectKey(folder) {
    let path = resolve(folder);
    try {
        path = realpathSync(path);
    }
    catch { /* A new workspace may not exist yet. */ }
    let cursor = path;
    for (;;) {
        if (existsSync(join(cursor, '.git'))) {
            path = cursor;
            break;
        }
        const parent = dirname(cursor);
        if (parent === cursor)
            break;
        cursor = parent;
    }
    return process.platform === 'win32' ? path.toLowerCase() : path;
}
export class ProjectQueue {
    tails = new Map();
    lifetime = new AbortController();
    async acquire(key, signal) {
        const bounded = signal ? AbortSignal.any([signal, this.lifetime.signal]) : this.lifetime.signal;
        bounded.throwIfAborted();
        const previous = this.tails.get(key) ?? Promise.resolve();
        let unlock;
        const gate = new Promise(resolve => { unlock = resolve; });
        const tail = previous.then(() => gate);
        this.tails.set(key, tail);
        let released = false;
        const release = () => {
            if (released)
                return;
            released = true;
            unlock();
            void tail.then(() => { if (this.tails.get(key) === tail)
                this.tails.delete(key); });
        };
        let onAbort;
        const aborted = new Promise((_resolve, reject) => {
            onAbort = () => reject(bounded.reason);
            bounded.addEventListener('abort', onAbort, { once: true });
        });
        try {
            await Promise.race([previous, aborted]);
            bounded.throwIfAborted();
            return release;
        }
        catch (error) {
            release();
            throw error;
        }
        finally {
            bounded.removeEventListener('abort', onAbort);
        }
    }
    close() { this.lifetime.abort(); }
}

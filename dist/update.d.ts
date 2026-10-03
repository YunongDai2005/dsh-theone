export declare const REPOSITORY = "YunongDai2005/dsh-theone";
export declare const PACKAGE_NAME = "dsh-theone";
/** Where this copy was installed from, which decides where its updates come from. */
export type UpdateSource = 'github' | 'npm' | 'other';
export interface UpdateStatus {
    current: string;
    latest?: string;
    /** A newer version exists. */
    available: boolean;
    /** It can be installed from here (otherwise reinstall by hand). */
    installable: boolean;
    source: UpdateSource;
    /** installing → reloading (TheOne restarts itself; DSH keeps running), restart (applies after DSH restarts) or failed. */
    state?: 'installing' | 'reloading' | 'restart' | 'failed';
    /** Why it failed: MINIMUM_RELEASE_AGE, NETWORK, or the plugin manager's own code. */
    error?: string;
    /** A newer npm version that pnpm will accept only once it is a day old, and when that is. */
    waiting?: {
        version: string;
        readyAt: number;
    };
}
/**
 * pnpm, which DSH installs plugins with, refuses npm versions published less than a day ago
 * (minimumReleaseAge, a supply-chain safeguard). Updates from npm wait until then.
 */
export declare const RELEASE_AGE_MS: number;
/** The DSH plugin manager's install call, as TheOne uses it. */
export interface PluginInstaller {
    installBundle(spec: string, options?: {
        enabled?: boolean;
    }): Promise<{
        application: string;
        bundle?: string;
        error?: {
            code?: string;
            message?: string;
        } | unknown;
        packageResult?: {
            output?: string;
        };
    }>;
}
/** Compare dotted versions numerically; a pre-release sorts before its release. */
export declare function compareVersions(a: string, b: string): number;
/** Read the dependency spec DSH saved for this plugin: GitHub, npm, or something else (a local path, a tarball). */
export declare function installSource(spec: string | undefined): UpdateSource;
/** Checks for a newer TheOne and installs it through DSH's own plugin manager. */
export declare class Updater {
    readonly current: string;
    private readonly spec;
    private readonly fetcher;
    private readonly now;
    private checked?;
    private state?;
    private error?;
    private pending?;
    constructor(current: string, spec: () => string | undefined, fetcher?: typeof fetch, now?: () => number);
    get source(): UpdateSource;
    /** The latest known status; checks again at most every six hours (or now, when forced). */
    status(force?: boolean): Promise<UpdateStatus>;
    /**
     * Install the newer version. With `reload`, TheOne then restarts itself so the new version runs
     * without restarting DSH; otherwise it is loaded the next time DSH starts.
     */
    install(installer: PluginInstaller | undefined, reload?: (bundle: string) => void): Promise<UpdateStatus>;
    private snapshot;
    private check;
}

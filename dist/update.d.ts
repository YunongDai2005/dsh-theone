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
    /** Why it failed: MINIMUM_RELEASE_AGE, OTHER_RELEASE_AGE (another package is too new), NETWORK, or the plugin manager's own code. */
    error?: string;
    /** pnpm's own words about the failure, or the packages it refused. */
    detail?: string;
    /** A newer npm version that pnpm will accept only once it is a day old, and when that is. */
    waiting?: {
        version: string;
        readyAt: number;
    };
    /** TheOne is exempt from that rule in this DSH profile, so fresh versions install right away. */
    exempt?: boolean;
    /** Whether this profile's pnpm settings can be edited to grant that exemption. */
    canExempt?: boolean;
}
/** The packages a pnpm-workspace.yaml exempts from the release-age rule (block or flow list). */
export declare function releaseAgeExemptions(text: string): string[];
/**
 * The same pnpm-workspace.yaml with `name` added to the release-age exemptions, every other line
 * kept as it was. Throws for a layout it does not recognise rather than guess.
 */
export declare function withReleaseAgeExemption(text: string, name?: string): string;
/**
 * The packages pnpm refused for being too new, as `name@version`, read from its output
 * ("dsh-theone@0.3.13 was published at …").
 */
export declare function releaseAgeViolations(output: string): string[];
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
    private readonly workspace;
    private checked?;
    private state?;
    private error?;
    private detail?;
    private pending?;
    /**
     * @param workspace - this DSH profile's pnpm-workspace.yaml, where pnpm reads the release-age
     * exemptions; undefined when the profile is unknown.
     */
    constructor(current: string, spec: () => string | undefined, fetcher?: typeof fetch, now?: () => number, workspace?: () => string | undefined);
    /** Whether pnpm in this profile already lets TheOne install versions under a day old. */
    get exempt(): boolean;
    /** Exempt TheOne, and only TheOne, from pnpm's release-age rule in this profile. */
    allowFresh(): void;
    /** Add exact `name@version` exemptions too, the form pnpm writes itself; returns whether the file changed. */
    private exemptExact;
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

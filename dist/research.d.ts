export interface PullSnapshot {
    url: string;
    title: string;
    sha: string;
    state: 'open' | 'closed';
    merged: boolean;
    checks: {
        name: string;
        state: string;
        summary: string;
    }[];
    partial: boolean;
    status: 'pending' | 'passed' | 'failed';
    fingerprint: string;
}
export declare function workError(code: string): Error & {
    code: string;
};
export declare function pullSource(url: string): {
    owner: string;
    repo: string;
    number: string;
    url: string;
};
/** Deliberately no credentials, arbitrary URL transport, write methods, or agent tools. */
export declare function readPullRequest(url: string, signal: AbortSignal, fetcher?: typeof fetch): Promise<PullSnapshot>;

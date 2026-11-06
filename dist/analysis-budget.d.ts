export interface AnalysisDelay {
    code: 'ROUTER_RATE_LIMITED' | 'ROUTER_CIRCUIT_OPEN';
    retryAfterMs: number;
}
/** One budget per host runtime, shared by routing and tool-free background analysis (not Worker replies). */
declare class AnalysisBudget {
    private readonly now;
    private calls;
    private failures;
    private lastFailureAt;
    private blockedUntil;
    constructor(now: () => number);
    delay(): AnalysisDelay | undefined;
    /** Called synchronously immediately before each stream, including retries. */
    take(): AnalysisDelay | undefined;
    succeeded(): void;
    failed(status?: number): void;
}
export declare function analysisBudget(runtime: object, now?: () => number): AnalysisBudget;
export {};

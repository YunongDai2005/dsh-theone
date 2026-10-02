import { Context, Service } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm';
import type { SessionEventWindow } from '@deepseek-ai/dsh-session-query';
import { HistoryCatalog } from './history-catalog.ts';
import { ContextStore } from './store.ts';
import type { RouterReceipt } from './llm-router.ts';
import { type SettingsSnapshot } from './settings-types.ts';
export interface Config {
    databasePath?: string;
    contextsPath?: string;
    gatewayKey: string;
    workerProvider?: string;
    workerModel?: string;
    maxDescriptorChars: number;
    maxResponseChars: number;
    routerMode?: 'rules' | 'llm';
    routerTransport?: 'dsh' | 'legacy';
    historyCatalog?: boolean;
    catalogIntervalMs?: number;
    routerBaseUrl?: string;
    routerModel?: string;
    routerApiKeyEnv?: string;
}
declare module '@deepseek-ai/cordis' {
    interface Context {
        theone: TheOne;
    }
}
declare module '@deepseek-ai/dsh-llm' {
    interface MessageSourceMap {
        'theone-route': {
            kind: 'theone-route';
            form: 'notice';
            summary: string;
            messageId: string;
            router?: RouterReceipt;
        };
        'theone-context': {
            kind: 'theone-context';
            form: 'recall';
            contextId: string;
        };
    }
}
export default class TheOne extends Service {
    private readonly config;
    static inject: string[];
    static Config: z<Config>;
    readonly store: ContextStore;
    readonly catalog?: HistoryCatalog;
    private readonly workers;
    private readonly router?;
    private readonly workerSelections;
    private active;
    private reservedGateway;
    private readonly gatewayDirectory;
    /** Gateway id → the Worker activity its current turn is showing. */
    private readonly runs;
    /** Gateway id → cleanup of a run whose main-chat turn has closed while its Worker winds down. */
    private readonly closing;
    constructor(ctx: Context, config: Config);
    /** DSH Connection protects plugin routes inside its authenticated /api fence. */
    private registerCatalogChannel;
    /** Read only public options; never read or return the API key environment value. */
    settingsSnapshot(): Promise<SettingsSnapshot>;
    /** Capture before Web saves the gateway itself as DSH's new default. */
    captureDefaultModel(): void;
    private backingModel;
    /** The entry has exactly the configured backing model's capacity, including DSH overrides. */
    gatewayModelInfo(provider?: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo>;
    /** Recover bounded routing context from DSH references after the Gateway is rebuilt. */
    private recentMessages;
    /** Literal Unicode search over reviewed ranges; failures are isolated per source. */
    searchHistoryDetailed(contextId: string, query: string, limit?: number, signal?: AbortSignal): Promise<{
        windows: SessionEventWindow[];
        documents: {
            sessionId: string;
            seq: number;
            text: string;
        }[];
        failures: {
            sessionId: string;
            code: string;
        }[];
        partial: boolean;
    }>;
    /** Convenience API. Use searchHistoryDetailed when source diagnostics matter. */
    searchHistory(contextId: string, query: string, limit?: number): Promise<SessionEventWindow[]>;
    private worker;
    private refreshCompactionSummary;
    /**
     * No one views a Worker session, so its approval questions would fail closed. Ask in the
     * main chat whose turn the Worker is answering instead, naming the exact call being approved.
     */
    private forwardApprovals;
    /** Wait briefly for the main chat to log its mirror of a Worker tool call. */
    private mirroredCall;
    /** Questions the Worker asks the user (ask_user_question) are answered in the main chat, like approvals. */
    private forwardQuestions;
    /** Capability is scoped to the exact owned Worker; the model cannot select another Context. */
    private registerWorkerTools;
    /** Mirror the routed Worker's steps into the main chat; tools execute exclusively in the Worker. */
    answer(options: GenerateOptions): AsyncIterable<StreamChunk>;
    /**
     * Settle a run when the main chat turn closes: record the outcome and free the gateway once the
     * Worker is idle. An abandoned (cancelled or failed) turn is recorded as failed immediately.
     */
    private finishRun;
    /** Worker-only tools (e.g. TheOne's own) become visible to the main chat so their calls render as cards. */
    private showWorkerTools;
    /**
     * Main-chat tool calls only mirror Worker calls. The main chat never runs a tool itself: outside a
     * run (or for a nested dispatch) its calls are refused rather than executed.
     */
    private mirroredRun;
    private runForWorker;
}

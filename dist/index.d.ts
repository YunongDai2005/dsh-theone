import { Context, Service } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm';
import type { SessionEventWindow } from '@deepseek-ai/dsh-session-query';
import { HistoryCatalog } from './history-catalog.ts';
import { ContextStore } from './store.ts';
import type { RouterReceipt } from './llm-router.ts';
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
    constructor(ctx: Context, config: Config);
    /** DSH Connection protects plugin routes inside its authenticated /api fence. */
    private registerCatalogChannel;
    /** Capture before Web saves the gateway itself as DSH's new default. */
    captureDefaultModel(): void;
    private backingModel;
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
    /** Capability is scoped to the exact owned Worker; the model cannot select another Context. */
    private registerWorkerTools;
    /** Stream text from committed worker attempts; tools execute exclusively in the worker. */
    answer(options: GenerateOptions): AsyncIterable<StreamChunk>;
    private relay;
}

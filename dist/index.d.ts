import { Context, Service } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type { GenerateOptions, LlmModelInfo, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm';
import type { ModelSelection } from '@deepseek-ai/dsh-agent';
import type { SessionEventWindow } from '@deepseek-ai/dsh-session-query';
import { HistoryCatalog } from './history-catalog.ts';
import { ContextStore } from './store.ts';
import type { RouterReceipt } from './llm-router.ts';
import type { LinkageSnapshot } from './catalog-types.ts';
import { type SettingsSnapshot } from './settings-types.ts';
import { type LinkScope } from './linkage.ts';
import { Updater } from './update.ts';
import { NoticeBoard } from './notices.ts';
export interface Config {
    databasePath?: string;
    contextsPath?: string;
    gatewayKey: string;
    workerProvider?: string;
    workerModel?: string;
    maxDescriptorChars: number;
    maxResponseChars: number;
    routerMode?: 'rules' | 'llm';
    /** @deprecated The direct DeepSeek router was removed; routing always uses DSH. Accepted and ignored. */
    routerTransport?: 'dsh' | 'legacy';
    historyCatalog?: boolean;
    catalogIntervalMs?: number;
    routerBaseUrl?: string;
    routerModel?: string;
    routerApiKeyEnv?: string;
    linkScope?: LinkScope;
    routeNotice?: 'hidden' | 'switch' | 'all';
    /** Show notices the maintainer publishes (read from a static file; nothing is sent). */
    notices?: boolean;
    /** Where notices are read from; for testing. */
    noticeUrl?: string;
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
        'theone-links': {
            kind: 'theone-links';
            form: 'recall';
            contextId: string;
            related: string[];
        };
    }
}
export declare function viaModel(selection: ModelSelection): string;
export declare function parseVia(id: string | undefined): ModelSelection | undefined;
export default class TheOne extends Service {
    private config;
    static inject: string[];
    static Config: z<Config>;
    readonly store: ContextStore;
    readonly catalog?: HistoryCatalog;
    private readonly workers;
    private router?;
    private readonly workerSelections;
    private active;
    private reservedGateway;
    private readonly gatewayDirectory;
    /** Gateway id → the Worker activity its current turn is showing. */
    private readonly runs;
    /** Gateway id → cleanup of a run whose main-chat turn has closed while its Worker winds down. */
    private readonly closing;
    /** A model the user picked in main chat's own model selector; it answers through the Workers. */
    private pickedModel?;
    private adapter?;
    /** Update checks and one-click install through DSH's plugin manager. */
    readonly updater: Updater;
    readonly noticeBoard: NoticeBoard;
    /** Sessions whose current step answers through TheOne; only these refuse to run tools themselves. */
    private readonly throughTheOne;
    constructor(ctx: Context, config: Config);
    /** DSH Connection protects plugin routes inside its authenticated /api fence. */
    private registerCatalogChannel;
    /** One topic-directory edit. Changes that remove a topic wait until no reply is running. */
    private editTopics;
    /** Existing DSH sessions a topic can take as history: not main chats and not topics' own Workers. */
    private attachableSessions;
    /** Read only public options; never read or return the API key environment value. */
    settingsSnapshot(): Promise<SettingsSnapshot>;
    private routerFor;
    /** Saved settings take effect for the next message; only the background catalog waits for a restart. */
    private applySettings;
    /** Capture before Web saves the gateway itself as DSH's new default. */
    captureDefaultModel(): void;
    private backingModel;
    /** Every model DSH offers besides TheOne; a provider that cannot list its models in time offers none. */
    private offeredModels;
    /**
     * Main chat's model menu has one TheOne entry; the background model is chosen with the button
     * beside it. Selections of the older "TheOne · <model>" entries still resolve.
     */
    gatewayModels(provider: string): Promise<LlmModelInfo[]>;
    /** The entry has exactly the backing model's capacity, including DSH overrides. */
    gatewayModelInfo(provider?: string, signal?: AbortSignal, model?: string): Promise<LlmResolvedModelInfo>;
    /** This main chat's recent text turns, each attributed to the topic it was routed to. */
    private recentMainChat;
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
    /** The backing model, with the thinking effort chosen in main chat when that model offers it. */
    private workerModel;
    /** The Worker runs under the permission mode chosen in main chat (sandbox and approval together). */
    private syncPermissions;
    private refreshCompactionSummary;
    private get linkScope();
    linkageSnapshot(): LinkageSnapshot;
    /**
     * Cross-topic reference for a Worker about to start: the recent main chat after a topic switch,
     * and the news of related topics (plus those the request itself named). Undefined when empty.
     */
    private briefingFor;
    /**
     * No one views a Worker session, so its approval questions would fail closed. Ask in the
     * main chat whose turn the Worker is answering instead, naming the exact call being approved.
     */
    private forwardApprovals;
    /**
     * A topic another topic's Worker may read: never private or kept apart by the user, and within
     * the linking scope. Reading it is evidence the two are related.
     */
    private readableTopic;
    /** Wait briefly for the main chat to log its mirror of a Worker tool call. */
    private mirroredCall;
    /** Questions the Worker asks the user (ask_user_question) are answered in the main chat, like approvals. */
    private forwardQuestions;
    /** Capability is scoped to the exact owned Worker; the model cannot select another Context. */
    private registerWorkerTools;
    /** Mirror the routed Worker's steps into the main chat; tools execute exclusively in the Worker. */
    answer(options: GenerateOptions): AsyncIterable<StreamChunk>;
    /** The message answered just before `inputId` in this main chat, with the topic it went to. */
    private previousRoute;
    /** Route a misrouted message again, never back to the topic it was wrongly given. */
    private reroute;
    /** Learning from corrections in flight; tests and shutdown can wait for it. */
    learning: Promise<void>;
    /**
     * The user moved a message to another topic: remember it, and teach both topics. The right topic
     * gains the message's distinctive terms and the wrong one loses them; `weight` is lower for
     * implicit signals. The model picks the terms in one small call; plain extraction is the fallback.
     */
    private applyCorrection;
    /** Ask the selected model, thinking off, for the few terms that tie a message to its topic. */
    private pickTerms;
    /** Topics with the terms corrections taught them added to their own keywords. */
    private routingContexts;
    /**
     * Favour topics used recently or often, and those linked to the current one, when narrowing
     * candidates. It stays below one matching term (10), so it only orders otherwise similar topics.
     */
    private routingPrior;
    /** The past corrections most like this message, as examples for the classifier. */
    private similarCorrections;
    /** The misrouted message, handed to the right topic with the user's correction. */
    private correctedInput;
    /** Topic → when main chat last answered in it; quick alternation between two topics links them. */
    private lastRoute?;
    private learnFromRoute;
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

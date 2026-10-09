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
import { type FeedbackDraft } from './feedback.ts';
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
    /** Experimental: topics share confirmed facts (a figure, a decision) with evidence and versions. */
    factLinks?: boolean;
    /** With factLinks: after each turn, a small model call proposes facts the Worker did not record. */
    factExtraction?: boolean;
    /** A routing card per topic, written in the background after its first replies; on unless turned off (tests). */
    topicCards?: boolean;
    /** Where notices are read from; for testing. */
    noticeUrl?: string;
    /** Where problem reports are sent when the user presses Send; "off" leaves only copy and email. For testing. */
    feedbackUrl?: string;
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
        'theone-welcome': {
            kind: 'theone-welcome';
            form: 'notice';
            locale: string;
        };
        /** Something TheOne did on the user's behalf outside a reply (a branch), said in main chat. */
        'theone-note': {
            kind: 'theone-note';
            form: 'notice';
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
    /**
     * Main-chat message id → the topic already working on it in the background: a message about another
     * matter, sent while a reply was running. Main chat shows that work when it gets to the message.
     */
    private readonly background;
    /** "<main chat id>:<seq>" of a changed-files record shown in main chat → the topic's own record. */
    readonly changeLinks: Map<string, {
        sessionId: string;
        seq: number;
        turn: number;
    }>;
    /** Main-chat message id → its classification, made while a reply was running. */
    private readonly sorting;
    /** Notices shown in main chat for work a topic took up on its own (see relay). */
    private readonly relays;
    /** Interjections TheOne moves to the queue; their inbox events are its own. */
    private readonly moving;
    /** Gateway id → cleanup of a run whose main-chat turn has closed while its Worker winds down. */
    private readonly closing;
    /** A model the user picked in main chat's own model selector; it answers through the Workers. */
    private pickedModel?;
    private adapter?;
    /** Update checks and one-click install through DSH's plugin manager. */
    readonly updater: Updater;
    readonly noticeBoard: NoticeBoard;
    /** Goal id → the topic its rounds work in (the topic in use when the goal was set). */
    private readonly goalTopics;
    /** Sessions whose current step answers through TheOne; only these refuse to run tools themselves. */
    private readonly throughTheOne;
    constructor(ctx: Context, config: Config);
    /** DSH Connection protects plugin routes inside its authenticated /api fence. */
    private registerCatalogChannel;
    /** One topic-directory edit. Changes that remove a topic wait until no reply is running. */
    private editTopics;
    /** Existing DSH sessions a topic can take as history: not main chats and not topics' own Workers. */
    private attachableSessions;
    /**
     * What a problem report carries before the user adds their words: versions, settings and how
     * routing went, without message text or topic names. With `messageId`, also how that message's
     * reply in main chat compares with its topic session, and the texts themselves if `includeReply`.
     */
    feedbackDraft(messageId: string | undefined, includeReply: boolean): Promise<FeedbackDraft>;
    /** Read only public options; never read or return the API key environment value. */
    settingsSnapshot(): Promise<SettingsSnapshot>;
    private routerFor;
    /** Saved settings take effect for the next message; only the background catalog waits for a restart. */
    private applySettings;
    /**
     * TheOne's own sessions live in DSH's archive, so DSH's own list stays the user's alone, with
     * TheOne on or off, and after a crash. A topic session leaves the archive only while it answers;
     * main chat, which the user types into, is archived when TheOne is turned off and back out when
     * it is on again. Only sessions TheOne made are ever archived, and only those it archived itself
     * are ever taken out.
     */
    private ownArchive?;
    /** Turning off: archive main chat and anything of TheOne's still out. Read before any wait, as the database closes alongside. */
    private stowOwnSessions;
    /** Turning on: main chats TheOne archived come back out; topic sessions it finds out are put away. */
    private unstowOwnSessions;
    /** A topic session must be out of the archive to answer: DSH does not run archived sessions. */
    private readyToRun;
    /** Put a topic session back once it is idle; DSH refuses while it still runs, so try again shortly. */
    private stowWhenIdle;
    /**
     * DSH saves any session's model choice as its global default, so main chat choosing TheOne used
     * to make every new ordinary chat a TheOne chat. TheOne must not change the user's settings:
     * before main chat picks its model the default is held, and put back right after.
     */
    private heldDefault?;
    holdDefaultModel(): void;
    restoreDefaultModel(): Promise<void>;
    /** Once: undo the default earlier versions left as TheOne, back to the model in use before it. */
    private repairDefaultModel;
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
    /**
     * DSH's own folder for chats outside any project (Documents/deepseek-harness/default-workspace),
     * when the user has it. TheOne only works in it; it never creates the folder or the workspace.
     */
    private defaultWorkspaceDirectory;
    /** The backing model, with the thinking effort chosen in main chat when that model offers it. */
    private workerModel;
    /** The Worker runs under the permission mode chosen in main chat (sandbox and approval together). */
    private syncPermissions;
    /** The topic plans instead of acting while main chat is in plan mode (/plan), as an ordinary chat would. */
    private syncPlanMode;
    private refreshCompactionSummary;
    private get linkScope();
    linkageSnapshot(): LinkageSnapshot;
    /**
     * Cross-topic reference for a Worker about to start: the recent main chat after a topic switch,
     * and the news of related topics (plus those the request itself named). Undefined when empty.
     */
    /** Confirmed facts this message might use (see fact-flow). */
    private factCandidates;
    /** What a topic is told about facts before its Worker answers (see fact-flow). */
    private factDelivery;
    /** The topic's own recorded facts for its Worker's descriptor; empty unless shared facts are on. */
    private ownFacts;
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
    /** Recording facts with evidence, and looking up other topics' confirmed facts (shared facts only). */
    private registerFactTools;
    /** Mirror the routed Worker's steps into the main chat; tools execute exclusively in the Worker. */
    answer(options: GenerateOptions): AsyncIterable<StreamChunk>;
    /**
     * Which topic a message is about: candidate search, then the classifier (with a review of the rest
     * of the catalog before a new topic), or rules when there is none. `running` describes a reply
     * still being written when the message was sent.
     */
    private classify;
    /** The user's project folders: DSH workspaces that exist, other than DSH's default one and TheOne's own. */
    private projectFolders;
    /**
     * Classify a message sent while `run` is replying. About that reply (or undecidable): an interjection
     * reaches it, a queued one waits, as in an ordinary session. About another matter: its topic starts
     * on it now in the background, and an interjection becomes its own turn instead of joining the reply.
     */
    private sortMidReply;
    /** The other matter a message sent during `run` is about, or nothing when it is about that reply or unsure. */
    private otherMatter;
    /**
     * Start a topic on a message main chat will get to later. At most three topics work at once (the
     * one shown and two in the background), and a topic works on one thing at a time; otherwise the
     * message simply waits its turn.
     */
    private startBackground;
    /**
     * A topic took up work on its own: follow it from now, and put a line in main chat whose turn shows
     * that work, after anything main chat is already answering. The topic becomes the one in use then.
     */
    private relay;
    /** Move an interjection to the queue, after what is already queued: it is answered as its own turn. */
    private requeue;
    /** Stop background work on a message main chat will not show (deleted, or answered with other input). */
    private dropBackground;
    /** A reply or background work is under way. */
    private get busy();
    /** Start the routed topic working on `input`; `register` sees the run before the Worker starts. */
    private startRun;
    /** The message answered just before `inputId` in this main chat, with the topic it went to. */
    private previousRoute;
    /** Route a misrouted message again, never back to the topic it was wrongly given. */
    private reroute;
    /** Learning from corrections in flight; tests and shutdown can wait for it. */
    learning: Promise<void>;
    /** Fact extractions in flight, one queue per topic so they commit in turn order. */
    private readonly extractions;
    /** All extractions in flight; tests and shutdown can wait for it. */
    get extracting(): Promise<void>;
    /** Queue an extraction of the turn that just ended in `worker`'s topic. */
    private queueExtraction;
    /** Queue a routing card for this topic, after any extraction already queued for it. */
    private queueCard;
    private writeCard;
    private extractFacts;
    /**
     * The user moved a message to another topic: remember it, and teach both topics. The right topic
     * gains the message's distinctive terms and the wrong one loses them; `weight` is lower for
     * implicit signals. The model picks the terms in one small call; plain extraction is the fallback.
     */
    private applyCorrection;
    /** Ask the selected model, thinking off, for the few terms that tie a message to its topic. */
    private pickTerms;
    /**
     * Topics as routing sees them: with the terms corrections taught them, and when each was last
     * active. Topics set aside (untouched for longer than this user usually comes back) go last.
     */
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
    /**
     * DSH treats a session that never had a turn as blank, and a blank session outside any workspace
     * locks its input until a workspace is chosen. The main chat belongs to no workspace, so a new one
     * opens with a short welcome turn, which also tells the user how it works. No model is called.
     */
    /** A service as one session sees it: DSH composes many (commands, compaction) inside its agent preset. */
    private agentService;
    /**
     * Branch the topic that answered main chat's message at `atSeq` (the latest one when absent): fork
     * its session at the end of that answer into a new topic, which main chat continues in.
     */
    branch(gatewayId: string, atSeq?: number): Promise<{
        contextId: string;
        title: string;
    }>;
    /** The language main chat was opened in. */
    gatewayLocale(gatewayId: string): string;
    /** The folder the topic in use works in, for main chat's file panel and "@" file references. */
    topicFolder(): Promise<string | undefined>;
    /** The topic folder last worked out, for DSH callers that need it at once (a new terminal). */
    lastTopicFolder?: string;
    /** Main chats that already have their own commands. */
    private readonly commandsInstalled;
    /**
     * /compact in main chat compacts the topic in use as well: that is where the long context is.
     * Registered on main chat alone, it takes the place of DSH's /compact there and nowhere else.
     */
    private gatewayCommands;
    welcomeGateway(id: string, locale: string): void;
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
    /**
     * Show a topic's changed-files or handed-over-files record under main chat's current reply: the
     * changes are read from the topic's own record; handed-over files are copied, under the same call
     * id as the tool card main chat already shows.
     */
    private mirrorRecord;
    /** Main chat's own folder, where nothing happens; side panels show the topic's folder instead. */
    isGatewayFolder(path: string | undefined): boolean;
    /** The topic of a run main chat is not showing yet (work started on a message sent during another reply). */
    private backgroundTopic;
    private runForWorker;
}

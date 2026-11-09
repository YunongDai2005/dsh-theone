import { Context, Service } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type { GenerateOptions, LlmModelInfo, LlmResolvedModelInfo, StreamChunk, UserMessage } from '@deepseek-ai/dsh-llm';
import type { ModelSelection } from '@deepseek-ai/dsh-agent';
import type { SessionEventWindow } from '@deepseek-ai/dsh-session-query';
import { HistoryCatalog } from './history-catalog.ts';
import { ContextStore } from './store.ts';
import { RoutingBindings, type BindingInput } from './routing-bindings.ts';
import { RoutingShadow } from './routing-shadow.ts';
import type { RoutingVariant } from './routing-experiments.ts';
import type { RouterReceipt } from './llm-router.ts';
import type { LinkageSnapshot } from './catalog-types.ts';
import { type SettingsSnapshot } from './settings-types.ts';
import { type LinkScope } from './linkage.ts';
import { Updater } from './update.ts';
import { NoticeBoard } from './notices.ts';
import { type FeedbackDraft } from './feedback.ts';
import { WeixinBridge } from './weixin.ts';
import { TelegramApp } from './telegram.ts';
import { IMessageApp } from './imessage.ts';
import { PersistentWork } from './persistent-work.ts';
import { BubbleAggregator } from './bubble-aggregator.ts';
import { BubbleActivity } from './bubble-activity.ts';
import type { BubbleView } from './bubble-types.ts';
import { TopicMergeQueue } from './topic-merge-queue.ts';
export interface Config {
    databasePath?: string;
    contextsPath?: string;
    gatewayKey: string;
    workerProvider?: string;
    workerModel?: string;
    maxDescriptorChars: number;
    maxResponseChars: number;
    routerMode?: 'rules' | 'llm';
    /** Opt-in cache experiments; none preserves the original wire protocol. */
    routingVariant?: RoutingVariant;
    /** @deprecated The direct DeepSeek router was removed; routing always uses DSH. Accepted and ignored. */
    routerTransport?: 'dsh' | 'legacy';
    historyCatalog?: boolean;
    catalogIntervalMs?: number;
    routerBaseUrl?: string;
    routerModel?: string;
    routerApiKeyEnv?: string;
    linkScope?: LinkScope;
    routeNotice?: 'hidden' | 'switch' | 'all';
    hideTopicSessions?: boolean;
    /** Show notices the maintainer publishes (read from a static file; nothing is sent). */
    notices?: boolean;
    /** Experimental: topics share confirmed facts (a figure, a decision) with evidence and versions. */
    factLinks?: boolean;
    /** With factLinks: after each turn, a small model call proposes facts the Worker did not record. */
    factExtraction?: boolean;
    /** Experimental: topics can watch a GitHub PR and report back ("Ongoing tasks"). Off unless turned on in Settings. */
    persistentWork?: boolean;
    /** A routing card per topic, written in the background after its first replies; on unless turned off (tests). */
    topicCards?: boolean;
    /** Metadata-only routing observations; never consumed by the router. */
    routingShadow?: boolean;
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
            noticeId?: string;
            excludedRoute?: boolean;
        };
    }
}
export declare function viaModel(selection: ModelSelection): string;
export declare function parseVia(id: string | undefined): ModelSelection | undefined;
export declare const TERMS_PROMPT = "\u4F60\u5728\u5E2E\u8BDD\u9898\u8DEF\u7531\u5668\u4ECE\u7528\u6237\u7684\u66F4\u6B63\u4E2D\u5B66\u4E60\u3002\u7528\u6237\u786E\u8BA4\u8FD9\u6761 message \u5C5E\u4E8E rightTopic\uFF08\u800C\u4E0D\u662F wrongTopic\uFF09\u3002\n\u4ECE message \u539F\u6587\u4E2D\u6311\u51FA\u6700\u591A 4 \u4E2A\u80FD\u628A\u5B83\u548C rightTopic \u8054\u7CFB\u8D77\u6765\u3001\u53C8\u80FD\u548C wrongTopic \u533A\u5206\u5F00\u7684\u8BCD\u8BED\uFF1A\u9879\u76EE\u540D\u3001\u672F\u8BED\u3001\u4EA7\u54C1\u3001\u4EBA\u540D\u3001\u6587\u4EF6\u540D\u7B49\uFF0C\u6BCF\u4E2A 2\u201312 \u4E2A\u5B57\uFF0C\u5FC5\u987B\u5728 message \u4E2D\u539F\u6837\u51FA\u73B0\u3002\n\u4E0D\u8981\u9009\u6CDB\u6CDB\u7684\u8BCD\uFF08\u5982\u300C\u5E2E\u6211\u300D\u300C\u8FD9\u4E2A\u300D\u300C\u95EE\u9898\u300D\uFF09\uFF0C\u4E0D\u8981\u9009 wrongTopic \u7684\u540D\u5B57\u3002\u53EA\u8F93\u51FA JSON \u5B57\u7B26\u4E32\u6570\u7EC4\uFF0C\u4F8B\u5982 [\"\u6D88\u878D\u5B9E\u9A8C\",\"\u7B2C\u4E09\u7AE0\"]\u3002";
export default class TheOne extends Service {
    private config;
    static inject: string[];
    static Config: z<Config>;
    readonly bindings: RoutingBindings;
    readonly shadow?: RoutingShadow;
    shadowError?: string;
    readonly bubbles: BubbleAggregator;
    readonly bubbleActivity: BubbleActivity;
    private bubbleActivityNeedsSync;
    private readonly bubbleSessionDates;
    private readonly bubbleSessionsReady;
    private readonly bubbleSessionsAbort;
    readonly store: ContextStore;
    readonly work: PersistentWork;
    private readonly maintenance;
    readonly mergeQueue: TopicMergeQueue;
    private readonly projects;
    readonly catalog?: HistoryCatalog;
    private readonly workers;
    /** Per live Worker: a restart deliberately sends the full briefing again. */
    private readonly workerBriefings;
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
    /** Main chat id → the run a reply left when its topic handed the message back; main chat may still collect that call's result. */
    private readonly handedFrom;
    /** "<main chat id>:<seq>" of a changed-files record shown in main chat → the topic's own record. */
    /** Main-chat message id → its classification, made while a reply was running. */
    /** Background topics being started: message id → topic id; they count toward the limit. */
    private readonly starting;
    private readonly sorting;
    /** Notices shown in main chat for work a topic took up on its own (see relay). */
    private readonly relays;
    /** Interjections TheOne moves to the queue; their inbox events are its own. */
    private readonly moving;
    /** Gateway id → cleanup of a run whose main-chat turn has closed while its Worker winds down. */
    private readonly closing;
    private syncingMergeSuggestions;
    private readonly mergeVetter;
    /** A model the user picked in main chat's own model selector; it answers through the Workers. */
    private pickedModel?;
    private adapter?;
    /** Update checks and one-click install through DSH's plugin manager. */
    readonly updater: Updater;
    readonly noticeBoard: NoticeBoard;
    /** Messaging apps as second input boxes for main chat; each is off until the user signs it in under Settings. */
    readonly weixin: WeixinBridge;
    readonly telegram: TelegramApp;
    readonly imessage: IMessageApp;
    /** Goal id → the topic its rounds work in (the topic in use when the goal was set). */
    private readonly goalTopics;
    /** Sessions whose current step answers through TheOne; only these refuse to run tools themselves. */
    private readonly throughTheOne;
    constructor(ctx: Context, config: Config);
    /** Reads in-memory observations and store facts without loading sessions or starting work. */
    bubbleView(gatewayId?: string | null | undefined): BubbleView;
    private prepareBubblePublication;
    /** The API and snapshot use the same live ownership check; persisted observations cannot cancel work. */
    private workStopTarget;
    private stopWork;
    /** Stop this turn, retaining other inputs and waking their normal DSH routing/delivery. */
    private stopGatewayTurn;
    private topicDoneCapability;
    private bubbleTemporary;
    private workTasks;
    private deliverWorkNotice;
    /** DSH Connection protects plugin routes inside its authenticated /api fence. */
    private registerCatalogChannel;
    /** One topic-directory edit. Changes that remove a topic wait until no reply is running. */
    private editTopics;
    private validateMerge;
    /** The same lease gates Worker preparation and the whole structural edit, including disposal. */
    private mergeTopics;
    private catalogSessions;
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
     * When hiding is enabled, TheOne's own sessions live in DSH's archive, so DSH's list stays the user's alone, with
     * TheOne on or off, and after a crash. A topic session leaves the archive only while it answers;
     * main chat, which the user types into, is archived when TheOne is turned off and back out when
     * it is on again. Only sessions TheOne made are ever archived, and only those it archived itself
     * are ever taken out.
     */
    private ownArchive?;
    private readonly pendingStows;
    private readonly stowTimers;
    private stopping;
    /** Turning off: archive main chat and anything of TheOne's still out. Read before any wait, as the database closes alongside. */
    private stowOwnSessions;
    /** Restore plugin-stowed sessions, keeping idle topic sessions archived only when hiding is enabled. */
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
    /** Set while TheOne switches itself off and on to load an update, which is not a removal. */
    private reloadingSelf;
    /**
     * Whether this profile still selects TheOne. Removing or turning off a bundle takes it out of
     * `dsh.profile.bundles` before its plugins stop; a reload leaves it there. Unknown counts as selected.
     */
    selectedInProfile(dir: string | undefined): boolean;
    /** Removed or turned off: a default left as TheOne would fail every new chat (NO_ADAPTER), so it goes back to the model behind it. */
    releaseDefaultModel(): Promise<void>;
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
    /** Authenticated adapters submit references, never a caller-invented topic owner. */
    submitMessage(sessionId: string, text: string, binding?: BindingInput, mode?: 'followup' | 'steer'): UserMessage;
    private resolveBinding;
    private bindingDecision;
    private bindingSources;
    private routeSources;
    private routeBinding;
    private forwardToWorker;
    private recordBindingEvent;
    /** Observation failures are isolated: they cannot change a route or model request. */
    private observeShadow;
    private recordShadowEvent;
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
     * Before a topic changes something for a message (edits a file, runs a command, sends something),
     * check that it is the right topic for it: when routing hesitated, or when the target belongs to
     * another project, ask once in main chat. Reading and answering never wait; a confident route with
     * a target in its own project goes ahead.
     */
    private checkTargets;
    /** Why a change for this message may be in the wrong topic, in both languages, or undefined. */
    private targetDoubt;
    /**
     * No one views a Worker session, so its approval questions would fail closed. Ask in the
     * main chat whose turn the Worker is answering instead, naming the exact call being approved.
     */
    private forwardApprovals;
    /**
     * A topic another topic's Worker may read: never private or kept apart by the user, and within
     * the linking scope. Reading it is evidence the two are related.
     */
    /**
     * Search the topics that share with `reader` for `query`: those whose routed messages or entry name
     * it, then the most recently used, five at most (each search reads that topic's sessions).
     */
    private searchEverywhere;
    private readableTopic;
    /** Wait briefly for the main chat to log its mirror of a Worker tool call. */
    private mirroredCall;
    /** Questions the Worker asks the user (ask_user_question) are answered in the main chat, like approvals. */
    private forwardQuestions;
    /** Labels are the answer protocol: keep them short and unique even after truncation. */
    private choiceOptions;
    /** Ask in main chat, including during pre-step routing; an unavailable answerer keeps the old flow. */
    private askChoice;
    /** Capability is scoped to the exact owned Worker; the model cannot select another Context. */
    private registerWorkerTools;
    /** Recording facts with evidence, and looking up other topics' confirmed facts (shared facts only). */
    private registerFactTools;
    /** Mirror the routed Worker's steps into the main chat; tools execute exclusively in the Worker. */
    answer(options: GenerateOptions): AsyncIterable<StreamChunk>;
    /** Count every request that ran, including failed or unused concurrent review pages. */
    private decideRouting;
    /**
     * Which topic a message is about: candidate search, then the classifier (with a review of the rest
     * of the catalog before a new topic), or rules when there is none. `running` describes a reply
     * still being written when the message was sent.
     */
    private classify;
    /**
     * Other topics this message refers to by a number, code or name only they have mentioned: the lines
     * there that mention it. Topics kept apart from this one (private, unlinked) stay out.
     */
    private recallFor;
    /** Routing evidence for `text` from each topic's routed messages and what its catalog entry and card know. */
    private routingEvidence;
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
     * Show autonomous work in main chat without taking the foreground topic. A host-validated
     * delayed question answer is user input and does move focus to its owner.
     */
    private relay;
    /**
     * A topic's notice shown in main chat: one TheOne relayed, or one left in main chat's queue by a
     * restart (its work is gone then, so main chat just shows what it says).
     */
    private isRelay;
    /** The topic's turn for a message, read from its session (live, or as DSH saved it). */
    private turnOf;
    /**
     * Main chat's answer to a message a topic began on before a restart cut it off. A topic that
     * finished has its reply shown as it gave it; one cut off mid-way is described, with what it had
     * already done, and is not redone on its own: the user sees where it went and can say "continue".
     */
    private realign;
    /**
     * A message went to the wrong topic and was moved: record that topic's turn for it, so its history,
     * card and facts leave the turn out and the topic is told once; and say in main chat what that turn
     * already changed, since nothing is undone on its own.
     */
    private noteMisroute;
    /** Messages that reached this topic by mistake, told to it once, the next time it works. */
    private misrouteFor;
    /**
     * The topic's last run was cut off by a restart (in the background or in front): tell it once, the
     * next time it works, what it had done, so it checks before carrying on instead of repeating.
     */
    private resumeFor;
    /**
     * When a topic last did anything before `inputId`: its last routed message, or the last thing in
     * its own session (the user may have worked in the topic directly).
     */
    private lastActive;
    /** Move an interjection to the queue, after what is already queued: it is answered as its own turn. */
    private requeue;
    /** Stop background work on a message main chat will not show (deleted, or answered with other input). */
    private dropBackground;
    /** A reply or background work is under way. */
    private get busy();
    /** Start the routed topic working on `input`; `register` sees the run before the Worker starts. */
    /** `takeOver`: the run handing this message over still holds the project; waiting for it would wait on ourselves. */
    private startRun;
    /** The message answered just before `inputId` in this main chat, with the topic it went to. */
    private previousRoute;
    /**
     * The topic answering main chat's message says it is not its own. Route it again without that
     * topic and let main chat follow the right topic's answer from its next step; the first topic's
     * turn stops counting as its own. Once per message, and only for a reply main chat is showing.
     */
    private handBack;
    /** The shared handoff for a Worker's hand-back and the user's explicit target choice. */
    private handToTopic;
    /** Offer candidates only for the unclear correction the user already started. */
    private correctionChoice;
    /** Route a misrouted message again, never back to the topic it was wrongly given. */
    private reroute;
    /** Learning from corrections in flight; tests and shutdown can wait for it. */
    learning: Promise<void>;
    /** Drain due memory jobs; persisted retries remain scheduled across shutdown. */
    get extracting(): Promise<void>;
    /** Queue an extraction of the turn that just ended in `worker`'s topic. */
    private queueExtraction;
    /** Queue a routing card for this topic, after any extraction already queued for it. */
    private queueCard;
    /** Append a native surface replacement; original DSH logs and external effects remain intact. */
    private excludeWorkerSurface;
    private validMainEvents;
    private referenceSources;
    private workerLearning;
    private memorySources;
    private learningEvents;
    private queueMemory;
    private runMemory;
    private mergeVettingModel;
    /** Include pending routing and live inboxes; a new message cancels an already-running check. */
    private mergeVettingIdle;
    /** Candidate creation is synchronous and call-free. Only the idle timer sends model requests. */
    private queueMergeSuggestion;
    /** Called synchronously after the queue persists its reservation, before it yields or executes. */
    private mergeOperationChanged;
    /** Mutation/timer path only. Observation never expires a suggestion or drains the queue. */
    private syncMergeSuggestions;
    private closeMergeSuggestions;
    private respondMergeSuggestion;
    /**
     * The user moved a message to another topic: remember it, and teach both topics. The right topic
     * gains the message's distinctive terms and the wrong one loses them; `weight` is lower for
     * implicit signals. The model picks the terms in one small call; plain extraction is the fallback.
     */
    private applyCorrection;
    /** Ask the selected model, thinking off, for the few terms that tie a message to its topic. */
    private pickTerms;
    /** Work a topic's session is asking the user about (approvals, questions) counts as waiting on the user. */
    private readonly asking;
    private whileAsking;
    /**
     * The project a folder belongs to: the user's DSH workspace that holds it (the innermost one).
     * DSH's default workspace and TheOne's own folder belong to no project.
     */
    private projectOf;
    /**
     * Each topic's project and status. Status is kept apart from the topic's run records and derived
     * from the newest one, what the user said, and how long the topic has been left.
     */
    private topicStates;
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
    /** The topic "Continue chatting" just put in use, until main chat opens and says so. */
    private mountNotice?;
    /**
     * "Continue chatting" on another topic opens the same main chat, whose last exchange is still the
     * previous topic's. One line says which topic comes next and where it left off.
     */
    private announceMount;
    welcomeGateway(id: string, locale: string): void;
    /**
     * A message that draws on other topics links them. Switching between topics does not: working on
     * several unrelated things at once is what TheOne is for.
     */
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
    /** For main chat, the session of the topic in use (where its work runs); undefined for any other session. */
    topicSession(sessionId: string): string | undefined;
    /** Main chat's own folder, where nothing happens; side panels show the topic's folder instead. */
    isGatewayFolder(path: string | undefined): boolean;
    /** The topic of a run main chat is not showing yet (work started on a message sent during another reply). */
    private backgroundTopic;
    private runForWorker;
}

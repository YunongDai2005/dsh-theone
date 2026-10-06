import type { SessionEvent } from '@deepseek-ai/dsh-session';
import type { RouteView } from './types.ts';
/** Where reports go: a small Cloudflare Worker run by TheOne's maintainer (server/feedback). */
export declare const FEEDBACK_URL = "https://feedback.yulid.org/v1/reports";
export declare const FEEDBACK_EMAIL = "theone@yulid.org";
export declare const FEEDBACK_LIMITS: {
    readonly description: 4000;
    readonly contact: 200;
    readonly routes: 30;
    readonly replyText: 8000;
    readonly body: 60000;
};
/** Strings as they may leave this computer: secrets, emails, addresses and the home folder removed. */
export declare function scrub(value: unknown, home?: string): unknown;
/** Recent routes without their text or topics: what happened, how, how long, and any error code. */
export declare function routeDigest(routes: readonly RouteView[], now?: number): {
    corrected?: boolean | undefined;
    error?: string | undefined;
    ms?: number | undefined;
    model?: string | undefined;
    via?: "rules" | "llm" | undefined;
    minutesAgo: number;
    action: import("./types.ts").Action;
    reason: string;
    status: "planned" | "running" | "completed" | "failed";
}[];
/**
 * One exchange in a session: the user message `messageId` (or, failing that, the latest user message
 * with the same text) and every assistant text up to the next user message.
 */
export declare function exchange(events: readonly SessionEvent[], messageId: string, sameText?: string): {
    user: string;
    reply: string;
    steps: number;
} | undefined;
/**
 * Whether main chat showed what the topic's own session said, and signs of garbled text in either:
 * replacement characters (U+FFFD), stray control characters, and long runs of one repeated character.
 */
export declare function compareReplies(main: string, worker: string): {
    main: {
        chars: number;
        replacement: number;
        control: number;
        repeatedRuns: number;
    };
    worker: {
        chars: number;
        replacement: number;
        control: number;
        repeatedRuns: number;
    };
    firstDifference?: number | undefined;
    identical: boolean;
};
/** The part of a report about one message: always the comparison, the texts only when the user agreed. */
export declare function replySection(route: RouteView, main: ReturnType<typeof exchange>, worker: ReturnType<typeof exchange>, includeText: boolean, now?: number): {
    topicSessionReply?: string | undefined;
    mainChatReply?: string | undefined;
    message?: string | undefined;
    comparison?: {
        main: {
            chars: number;
            replacement: number;
            control: number;
            repeatedRuns: number;
        };
        worker: {
            chars: number;
            replacement: number;
            control: number;
            repeatedRuns: number;
        };
        firstDifference?: number | undefined;
        identical: boolean;
    } | undefined;
    topicSteps?: number | undefined;
    mainSteps?: number | undefined;
    route: {
        corrected?: boolean | undefined;
        error?: string | undefined;
        ms?: number | undefined;
        model?: string | undefined;
        via?: "rules" | "llm" | undefined;
        minutesAgo: number;
        action: import("./types.ts").Action;
        reason: string;
        status: "planned" | "running" | "completed" | "failed";
    };
    found: {
        mainChat: boolean;
        topicSession: boolean;
    };
};
export interface FeedbackDraft {
    v: 1;
    app: 'theone';
    version: string;
    diagnostics: Record<string, unknown>;
    reply?: Record<string, unknown>;
}
export interface FeedbackReport extends FeedbackDraft {
    lang: 'zh' | 'en';
    description: string;
    contact?: string;
}
/**
 * The report to send: the draft the user saw plus what they typed. The draft comes back from the
 * page, so it is checked and scrubbed again here; anything malformed is refused, not repaired.
 */
export declare function finalReport(input: Record<string, unknown>, version: string, home?: string): FeedbackReport;
/** Send a report; resolves to its id, or throws RATE_LIMITED, REJECTED, UNREACHABLE or SERVER_ERROR. */
export declare function sendReport(report: FeedbackReport, url?: string, fetcher?: typeof fetch): Promise<string>;

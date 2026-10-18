/**
 * A messaging app as a second input box for main chat, whatever the app. A message from the app's
 * owner goes into main chat the way typing in the browser does, so routing, topics and "wrong topic"
 * all work as usual; when main chat's turn for it ends, the reply goes back to the app. Approvals and
 * questions raised while answering such a message are asked in the app, answered with a number.
 * Each app supplies only a `RemoteChannel`: how to send text to its owner.
 */
import type { Context } from '@deepseek-ai/cordis';
/** An approval or question not answered in the app within this long is declined. */
export declare const ASK_TIMEOUT_MS: number;
/** One messaging app bound to main chat. */
export interface RemoteChannel {
    /** Short id; main chat messages from the app carry `<name>:` on their request id (`source.rpcId`). */
    name: string;
    /** Bound and able to send. */
    available(): boolean;
    /** Send text to the owner; the channel splits and formats it for the app. */
    send(text: string): Promise<void>;
    /** Show the owner that a reply is being worked on; best effort. */
    typing?(): Promise<void>;
}
export interface RelayHost {
    /** Main chat, when there is one. */
    gatewayId(): string | undefined;
    /** The language main chat was opened in. */
    locale(gatewayId: string): string;
}
export declare const RELAY_WORDS: {
    zh: {
        noMainChat: string;
        notDelivered: (reason: string) => string;
        failed: string;
        stopped: string;
        approval: (what: string) => string;
        approvalHint: string;
        question: (header: string | undefined, text: string, options: string[], multi: boolean) => string[];
        questionHint: string;
        unanswered: string;
    };
    en: {
        noMainChat: string;
        notDelivered: (reason: string) => string;
        failed: string;
        stopped: string;
        approval: (what: string) => string;
        approvalHint: string;
        question: (header: string | undefined, text: string, options: string[], multi: boolean) => string[];
        questionHint: string;
        unanswered: string;
    };
};
export declare class RemoteRelay {
    private readonly ctx;
    private readonly host;
    private readonly channel;
    /** How long an approval or question waits for an answer in the app. */
    askTimeoutMs: number;
    private asking?;
    /** Asks wait their turn: one question in the app at a time. */
    private queue;
    /** Main chat turns already answered in the app ("<session>:<turn end seq>"). */
    private readonly answered;
    private readonly prefix;
    constructor(ctx: Context, host: RelayHost, channel: RemoteChannel);
    /** Answer main chat's turns for the app, and take approvals and questions for them. */
    apply(): void;
    /** Words in main chat's language. */
    words(): typeof RELAY_WORDS.zh;
    /** A message from the owner: the answer to a pending question, or a message for main chat. */
    receive(id: string, text: string): Promise<void>;
    /** A note in main chat, where the user looks (for example, that the app's login expired). */
    note(text: string): void;
    /** Into main chat's queue, as the browser sends it; DSH's session controller wakes main chat if it is not loaded. */
    private prompt;
    /** Main chat's turn from `turn/start` to the event at `endSeq` (the open turn when absent). */
    private turnEvents;
    /** The turn answers a message sent from this app. */
    private fromChannel;
    private answerTurn;
    /** Answering a message from this app right now: questions for it go to the app. */
    private askingHere;
    private approval;
    private question;
    /**
     * Put one question to the app and wait for the owner's reply, `timeout` without one, or `cancelled`
     * when the request is withdrawn.
     */
    private ask;
}

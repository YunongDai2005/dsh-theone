/** Positions are native session sequence numbers, ordered across main-chat sessions.
 * They describe display order, never whether the user has read a message. */
export type DisplayOrder = [session: number, event: number];
export type MessageOrigin = 'user' | 'foreground' | 'background' | 'system';
export interface ShadowMessage {
    messageId: string;
    sessionId: string;
    seq: number;
    topicId: string | null;
    source: MessageOrigin;
    displayOrder: DisplayOrder;
    visible?: boolean;
    replyTo?: string;
    temporary?: boolean;
    basis?: string;
    completed?: boolean;
}
interface Focus {
    topicId: string;
    messageId: string;
    inputId: string;
    order: DisplayOrder;
    responseOrder?: DisplayOrder;
}
export interface PendingOwner {
    topicId: string;
    kind: 'question' | 'approval';
    messageId?: string;
    basis: 'host-request' | 'question-form';
}
type Binding = {
    topicId: string | null;
    temporary?: boolean;
    basis?: string;
    source?: MessageOrigin;
};
/** A conservative, explicitly labelled shadow inference; never a routing rule. */
export declare function temporaryArithmetic(text: string): boolean;
/** Separate durable metadata only. No caller may use this to construct routing inputs.
 * No message text, credentials, model payloads or executable actions are stored here. */
export declare class RoutingShadow {
    private readonly db;
    constructor(path: string);
    close(): void;
    private state;
    private save;
    private ordinal;
    message(gateway: string, session: string, message: string): ShadowMessage | undefined;
    binding(gateway: string, session: string, message: string): Binding | undefined;
    /** A route may be planned before the host commits the corresponding user event. */
    bind(gateway: string, session: string, message: string, binding: Binding): void;
    record(gateway: string, input: Omit<ShadowMessage, 'displayOrder'>): void;
    private advance;
    hasPending(gateway: string, messageId: string): boolean;
    openPending(gateway: string, owner: PendingOwner): string;
    closePending(gateway: string, id: string): void;
    snapshot(gateway: string): {
        messages: ShadowMessage[];
        background: ShadowMessage[];
        pending: {
            topicId: string;
            kind: "question" | "approval";
            messageId?: string;
            basis: "host-request" | "question-form";
            id: string;
        }[];
        focus?: Focus;
        durableTopicId?: string;
        durableFocus?: Focus;
        temporary?: {
            messageId: string;
            returnFocus?: Focus;
        };
    };
}
export {};

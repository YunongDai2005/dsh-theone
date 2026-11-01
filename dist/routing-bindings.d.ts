import { type LearningSource } from './learning-journal.ts';
/** Plugin input protocol, NOT additional fields invented on DSH's user source. */
export interface BindingInput {
    replyTo?: string;
    pendingResponse?: string;
    steeringOf?: string;
}
export interface BindingReference {
    id: string;
    sessionId: string;
    topicId: string;
    kind: 'reply' | 'question' | 'approval';
    source: 'foreground' | 'background' | 'inferred';
    sources: LearningSource[];
    request?: {
        callId?: string;
        questionIds?: string[];
    };
}
export interface SteeringOwner {
    inputId: string;
    topicId: string;
    sources: LearningSource[];
}
export interface BindingResolution {
    status: 'none' | 'applied' | 'rejected';
    kind?: 'reply' | 'question' | 'approval' | 'steering';
    topicId?: string;
    refs?: string[];
    sources?: LearningSource[];
    reason?: string;
}
export interface RoutingAttention {
    foreground?: {
        messageId: string;
        topicId: string;
    };
    background: {
        messageId: string;
        topicId: string;
    }[];
}
/** Server-owned provenance, separate from optional shadow observations. No text or grants.
 * Pending requests expire on runtime restart: an old UI answer must never revive a closed wait.
 * Registration is a trusted in-process producer seam; HTTP clients can only reference records.
 */
export declare class RoutingBindings {
    private gateway;
    private valid;
    private readonly db;
    private readonly runtime;
    constructor(path: string, gateway: string, valid: (sources: LearningSource[]) => boolean);
    close(): void;
    record(reference: BindingReference): void;
    closeReference(id: string): void;
    rememberInput(session: string, message: string, input: BindingInput): void;
    input(session: string, message: string): BindingInput;
    resolve(input: BindingInput, topics: ReadonlySet<string>, steering?: SteeringOwner): BindingResolution;
    /** Bounded reads; learning validity uses LearningJournal's existing stage cache. */
    attention(topics: ReadonlySet<string>): RoutingAttention | undefined;
    references(topics: ReadonlySet<string>): BindingReference[];
}
export declare function parseBindingInput(value: unknown): BindingInput;

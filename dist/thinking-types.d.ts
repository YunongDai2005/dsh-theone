/** Transient preview of the model's returned reasoning; never a history source. */
export interface ThinkingSnapshot {
    active: boolean;
    attemptId?: string;
    text: string;
    truncated: boolean;
}

/**
 * What a topic did with one message, read back from its own DSH session: whether its turn finished,
 * the reply it gave, and the steps that may have changed something. Used after a restart, when
 * TheOne's memory of the run is gone but the topic session (persisted by DSH) still has it all.
 */
interface Event {
    type: string;
    seq: number;
    data: unknown;
}
export interface TopicTurn {
    /** The message reached the topic. */
    found: boolean;
    /** What the user asked, as the topic received it. */
    request: string;
    /** Its turn ended normally. */
    completed: boolean;
    /** The topic's last words in that turn. */
    reply: string;
    /** Steps that may have changed something, in plain words ("修改 src/a.ts", "运行 npm test"). */
    changes: string[];
    /** The topic session's last event of that turn. */
    endSeq?: number;
}
/** One step in a few words, from the tool's name and the arguments the model gave it. */
export declare function describeStep(name: string, args: string): string;
/**
 * The topic's turn for message `messageId` (or, when it arrived batched under another id, the
 * latest one carrying `text`), up to the next message from the user.
 */
export declare function topicTurn(events: readonly Event[], messageId: string, text?: string): TopicTurn;
/** What the topic is told the next time it works, about the message a restart cut off. */
export declare function resumeNote(turn: TopicTurn): string;
export {};

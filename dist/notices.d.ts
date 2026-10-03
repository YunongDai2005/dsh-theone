/** Where TheOne's maintainer publishes notices: a static JSON file, read with a plain GET. */
export declare const NOTICE_URL = "https://yulid.org/theone/notice.json";
/** Text in each interface language; the reader's language is chosen in the client. */
export interface LocalizedText {
    zh?: string;
    en?: string;
}
/** One notice as the client shows it. */
export interface Notice {
    id: string;
    /** `important` opens a dialog once; `info` shows a strip under the main chat input. */
    level: 'info' | 'important';
    title: LocalizedText;
    body: LocalizedText;
    /** An https page to read more; opened only when the reader clicks it. */
    link?: string;
}
/**
 * Whether `version` falls within a range such as "<0.3.16", ">=0.3.10", "0.3.12", "*", or several
 * of these separated by spaces (all must hold). An unreadable range matches nothing.
 */
export declare function versionMatches(range: unknown, version: string): boolean;
/**
 * The notices in a published file that apply to this version now, at most five. Anything that does
 * not fit the format is skipped rather than shown; text is plain, links must be https.
 */
export declare function applicableNotices(file: unknown, version: string, now?: number): Notice[];
/** Reads the notice file at most every three hours; a failure simply means no notices. */
export declare class NoticeBoard {
    private readonly version;
    private readonly url;
    private readonly fetcher;
    private readonly now;
    private cache?;
    private pending?;
    constructor(version: string, url?: string, fetcher?: typeof fetch, now?: () => number);
    notices(): Promise<Notice[]>;
    private read;
}

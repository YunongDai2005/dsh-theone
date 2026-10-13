/** Markdown as WeChat shows it: plain text that still reads well. */
export declare function plainText(markdown: string): string;
/** Split a reply into parts of at most `limit` characters, at paragraph or line breaks where possible. */
export declare function splitText(text: string, limit: number): string[];

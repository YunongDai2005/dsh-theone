import type { ContextDescriptor, Decision } from './types.ts';
/** Conservative lexical routing. Ambiguous references need clarification. */
export declare function resolveContext(text: string, contexts: ContextDescriptor[], currentId?: string): Decision;

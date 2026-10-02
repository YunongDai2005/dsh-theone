import type { ContextDescriptor, Decision } from './types.ts';
/** Standalone misses start new topics; unresolved historical references ask. */
export declare function resolveContext(text: string, contexts: ContextDescriptor[], currentId?: string): Decision;

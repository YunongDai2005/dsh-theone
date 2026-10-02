import type { Context } from '@deepseek-ai/cordis';
declare module '@deepseek-ai/dsh-api-session-controller/client' {
    interface SessionReferenceSourceMap {
        mainView: unknown;
    }
}
export declare const inject: string[];
export declare function apply(ctx: Context): void;

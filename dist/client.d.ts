import type { Context } from '@deepseek-ai/cordis';
declare module '@deepseek-ai/dsh-api-session-controller/client' {
    interface SessionReferenceSourceMap {
        mainView: unknown;
    }
}
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface SlotMap {
        'conversation.composer.dock': {
            kind: 'list';
            scope: 'session';
        };
    }
}
export declare const inject: string[];
export declare function apply(ctx: Context): void;

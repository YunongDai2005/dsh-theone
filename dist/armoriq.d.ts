import { Context } from '@deepseek-ai/cordis';
import { type EnforceResult, type SDKConfig } from '@armoriq/sdk';
export declare const name = "theone-armoriq";
export declare const inject: string[];
export interface Config {
    /** The real ArmorIQ end-user identity; supplied by the operator, never the model. */
    userEmail: string;
    databasePath: string;
    apiKeyEnv?: string;
    validitySeconds?: number;
}
export declare function scopedAction(topic: string, action: string): string;
/** Fixed operator plan. Model calls can request actions, but cannot expand this plan. */
export declare class TopicGuard {
    private readonly email;
    private readonly validitySeconds;
    private readonly client;
    private readonly plans;
    constructor(email: string, options: Partial<SDKConfig>, validitySeconds?: number);
    private prepare;
    check(owner: string, target: string, action: string, signal?: AbortSignal): Promise<EnforceResult>;
    close(): Promise<void>;
}
export declare function apply(ctx: Context, config: Config): void;
declare const _default: {
    name: string;
    inject: string[];
    apply: typeof apply;
};
export default _default;

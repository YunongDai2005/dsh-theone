/**
 * One messaging app bound to main chat: its link (receiving) and relay (into main chat and back),
 * started with TheOne, plus the settings route every app shares. Each app adds its own sign-in.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { RelayHost, RemoteRelay } from './remote-relay.ts';
import type { LinkSaved, RemoteLink } from './remote-link.ts';
/** What a messaging app needs from TheOne: main chat, and where its login is kept. */
export interface AppHost<S> extends RelayHost {
    load(): S | undefined;
    save(saved: S | undefined): void;
    version: string;
}
export declare abstract class RemoteApp<S extends LinkSaved> {
    protected readonly ctx: Context;
    abstract readonly link: RemoteLink<S>;
    abstract readonly relay: RemoteRelay;
    constructor(ctx: Context);
    /** Answer main chat's turns for the app, and receive while TheOne runs. */
    apply(): void;
    /** The app's own sign-in actions: undefined when done, or a refusal (also for an action it does not know). */
    protected abstract action(row: Record<string, unknown>): Promise<Response | undefined> | Response | undefined;
    /** Stop a sign-in under way. */
    protected cancel(): void;
    /** The settings page: status, and sign-in, pause, resume and logout. */
    handle(request: Request): Promise<Response>;
}
/** A refusal the settings page can explain: `code` names it. */
export declare function refused(code: string, status?: number): Response;

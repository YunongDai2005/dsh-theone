/**
 * The topic cluster under TheOne's main-chat card: every topic is a round cell like the One mark, the cells
 * cling together like a raft of soap bubbles, and routing plays out on them (a message travels as a vesicle
 * into the topic it went to, new topics bud off the mark, answers travel back). Plain DOM and SVG; the host
 * feeds a model and routing events and receives the user's gestures as actions.
 */
/** idle, answering, waiting for a free slot, answered and not yet shown in main chat, waiting on the user (a question or approval), or failed/interrupted. */
export type FoamPhase = 'idle' | 'running' | 'queued' | 'answered' | 'waiting' | 'failed';
export interface FoamTopic {
    id: string;
    title: string;
    /** A short name for the cell when the title is too long (e.g. the topic's main keyword); the full title shows on hover. */
    label?: string;
    /** 0..1, how recently and often the topic was used; bigger and higher up when recent. */
    weight: number;
    phase: FoamPhase;
    /** Main chat is attached to this topic. */
    current?: boolean;
    /** A clarifying question in main chat names this topic as one of the candidates. */
    asking?: boolean;
    /** The user set it aside (TheOne's "done"); it waits in the fold until a message reaches it again. */
    aside?: boolean;
    /** A one-off aside question: small, and folds away once answered. */
    oneOff?: boolean;
    /** Topic workspace id; topics of one workspace stick together. */
    group?: string;
    /** When the current run started (ms since epoch), for the running hint. */
    startedAt?: number;
}
export interface FoamModel {
    topics: FoamTopic[];
    /** Learned or manual relatedness between topics, 0..1 (negative: the user kept them apart). */
    links?: {
        a: string;
        b: string;
        weight: number;
    }[];
    /** Merges waiting for the topics to go quiet. */
    pendingMerges?: {
        id: string;
        into: string;
    }[];
}
export type FoamEvent = 
/** A message settled on a topic; `alternates` were the other close candidates, they only flicker. */
{
    kind: 'route';
    to: string;
    related?: string[];
    alternates?: string[];
    messageId?: string;
}
/** More input for a topic that is already answering (steering). */
 | {
    kind: 'supplement';
    to: string;
} | {
    kind: 'create';
    to: string;
}
/** Routing is truly blocked and needs the user: the vesicle waits between the candidates. */
 | {
    kind: 'clarify';
    candidates: string[];
} | {
    kind: 'resolve';
    to?: string;
} | {
    kind: 'correct';
    from: string;
    to: string;
} | {
    kind: 'merged';
    id: string;
    into: string;
};
export type FoamTextKey = 'more' | 'running' | 'queued' | 'answered' | 'asking' | 'bond' | 'waiting' | 'failed' | 'menuAnswer' | 'offer' | 'rerouteBusy' | 'dropMain' | 'dropMerge' | 'dropMergeLater' | 'dropSession' | 'busyFling' | 'currentFling' | 'menuContinue' | 'menuOpen' | 'menuAside' | 'menuDelete' | 'menuStop' | 'menuCancel' | 'menuShowNow' | 'menuWorkspace';
export interface FoamActions {
    mount(id: string): void;
    merge(id: string, into: string, whenIdle: boolean): void;
    attach(id: string, sessionId: string): void;
    putAside(id: string): void;
    open(id: string): void;
    stop(id: string): void;
    cancelQueued(id: string): void;
    remove(id: string): void;
    showAnswer(id: string): void;
    /** Move a message routing hesitated over into the topic the user picked; resolves to the HTTP status. */
    reroute(messageId: string, to: string): Promise<number>;
    /** Go to where the topic waits on the user (its question or approval in main chat). */
    answer(id: string): void;
    openWorkspace(): void;
    text(key: FoamTextKey, vars?: Record<string, string | number>): string;
}
export interface FoamOptions {
    /** Absolutely positioned box right under the main card; the cells are drawn in it and may overflow upward over the card. */
    host: HTMLElement;
    /** The One mark in the main card: messages leave from it and answers return to it. */
    mark: () => Element | null;
    /** The sidebar: a cell thrown past its edge is set aside. */
    side: () => Element | null;
    actions: FoamActions;
    /** The cluster's height changed; the host makes room for it. */
    onHeight(height: number): void;
    /** Called at the start of every frame, so the host can keep the box aligned under the card. */
    place?(): void;
    /** How much the mark should swell right now (0..1): a message left, or an answer arrived. */
    onPulse?(amount: number): void;
    /** The sidebar starts collapsed: begin with the small cells instead of shrinking into them. */
    rail?: boolean;
}
export interface Foam {
    update(model: FoamModel): void;
    event(event: FoamEvent): void;
    setRail(on: boolean): void;
    destroy(): void;
}
/**
 * The name a cell can carry: the topic's own short label when it has one, else the title up to its first
 * punctuation ("想去日本旅游，帮我看看行程" → "想去日本旅游"). Always a whole phrase, never cut mid-word.
 */
export declare function foamShortName(title: string, label?: string): string;
/** How a name sits in a cell: one line if it fits, else two (big cells: three) balanced lines, else no text. Never a clipped name. */
export declare function foamLabel(name: string, radius: number): {
    lines: string[];
    font: number;
    lh: number;
};
export declare function createFoam(options: FoamOptions): Foam;
/** Colours follow the main card: warm tint and accent in light, blue in dark; idle cells take the sidebar's own fill. */
export declare const foamCss = "\n.theone-foam{position:fixed;left:0;top:0;width:0;height:8px;z-index:20;pointer-events:none;--foam-bg:var(--dsw-specific-sidebar-fill,#f7f7f5);--foam-tint:#fff5ec;--foam-accent:#a75b1e;--foam-heat:#ff7800;--foam-line:#c99267;--foam-done:#ffffff;--foam-idle-line:#d8d3ca;--foam-idle-dot:#cdb8a3;--foam-queue-line:#c4c1b8;--foam-queue-ink:#9a988f;--foam-fail:#b9785f;--foam-text:var(--dsw-alias-label-primary,#2b2b2b);--foam-muted:var(--dsw-alias-label-secondary,#8a8a86)}\n[data-ds-dark-theme] .theone-foam{--foam-bg:var(--dsw-specific-sidebar-fill,#1f1f22);--foam-tint:#1d2a37;--foam-accent:#93c8f3;--foam-heat:#80caff;--foam-line:#5d87ab;--foam-done:#2b2b30;--foam-idle-line:#4a515a;--foam-idle-dot:#5a7086;--foam-queue-line:#4d555e;--foam-queue-ink:#7f8a94;--foam-fail:#c98a74}\n.theone-foam>svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}\n.theone-foam-list{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}\n.theone-cell{cursor:grab;pointer-events:auto}\n.theone-cell.drag{cursor:grabbing}\n.theone-cell [data-part=body]{stroke:none;fill:var(--foam-bg);transition:fill .8s ease}\n.theone-cell [data-part=membrane]{fill:none;stroke:var(--foam-idle-line);stroke-width:1.2;stroke-linejoin:round;stroke-linecap:round;transition:stroke .8s ease,stroke-width .4s ease}\n.theone-cell [data-part=nucleus]{fill:var(--foam-idle-dot);transition:fill .6s ease,stroke .6s ease}\n.theone-cell text{fill:var(--foam-muted);text-anchor:middle;dominant-baseline:middle;pointer-events:none;user-select:none;letter-spacing:.02em;transition:fill .6s ease}\n.theone-cell.running [data-part=body],.theone-cell.queued [data-part=body]{fill:var(--foam-tint)}\n.theone-cell.running [data-part=membrane]{stroke:var(--foam-line);stroke-width:1.3}\n.theone-cell.running [data-part=nucleus],.theone-cell.done [data-part=nucleus]{fill:var(--foam-accent)}\n.theone-cell.running text,.theone-cell.done text{fill:var(--foam-text)}\n.theone-cell.done [data-part=body]{fill:var(--foam-done)}\n.theone-cell.done [data-part=membrane]{stroke:var(--foam-line);stroke-width:1.3}\n.theone-cell.queued [data-part=membrane]{stroke:var(--foam-queue-line)}\n.theone-cell.queued [data-part=nucleus]{fill:transparent;stroke:var(--foam-queue-ink);stroke-width:1}\n.theone-cell.queued text{fill:var(--foam-queue-ink)}\n.theone-cell.wait [data-part=body]{fill:var(--foam-tint)}\n.theone-cell.wait [data-part=membrane]{stroke:var(--foam-accent);stroke-width:1.4}\n.theone-cell.wait [data-part=nucleus]{fill:transparent;stroke:var(--foam-accent);stroke-width:1.4}\n.theone-cell.wait text{fill:var(--foam-text)}\n.theone-cell.fail [data-part=membrane]{stroke:var(--foam-fail);stroke-dasharray:1.5 2.5}\n.theone-cell.fail [data-part=nucleus]{fill:transparent;stroke:var(--foam-fail);stroke-width:1.2}\n.theone-cell.fail text{fill:var(--foam-fail)}\n.theone-cell.cur [data-part=body]{fill:var(--foam-tint)}\n.theone-cell.cur [data-part=membrane]{stroke:var(--foam-accent);stroke-width:1.4}\n.theone-cell.cur [data-part=nucleus]{fill:var(--foam-accent)}\n.theone-cell.cur text{fill:var(--foam-accent)}\n.theone-cell.lit [data-part=membrane]{stroke:var(--foam-accent);stroke-width:1.6;transition-duration:.15s}\n.theone-cell.ask [data-part=membrane]{stroke:var(--foam-accent);stroke-dasharray:3 3}\n.theone-cell.fuse [data-part=membrane]{stroke:var(--foam-accent);stroke-width:1.6}\n.theone-cell.more{cursor:pointer}\n.theone-cell.more [data-part=membrane]{stroke-dasharray:1.2 3}\n.theone-neck [data-part=edge]{fill:none;stroke:var(--foam-line);stroke-width:1.3;stroke-linecap:round}\n.theone-vesicle [data-part=membrane]{fill:var(--foam-tint);stroke:var(--foam-accent);stroke-width:1.1}\n.theone-vesicle [data-part=nucleus]{fill:var(--foam-accent)}\nhtml[data-theone-foam] button:has(.theone-workspace-entry){display:none}\n[data-row-key][data-theone-drop=true]{background:color-mix(in srgb,#ff7800 10%,transparent);box-shadow:inset 0 0 0 1px color-mix(in srgb,#a75b1e 40%,transparent);border-radius:10px}\n.theone-foam-tip{position:fixed;z-index:1000;padding:4px 8px;border-radius:7px;background:var(--dsw-alias-label-primary,#2e2d2a);color:var(--dsw-alias-bg-base,#f4f3ef);font-size:11.5px;line-height:1.5;white-space:nowrap;pointer-events:none;opacity:0;transform:translate(-50%,3px);transition:opacity .12s,transform .12s}\n.theone-foam-tip.on{opacity:1;transform:translate(-50%,0)}\n.theone-foam-menu{position:fixed;z-index:1000;min-width:168px;padding:4px;border:.5px solid var(--dsw-alias-border-l2,#8885);border-radius:var(--dsw-radius-lg,12px);background:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-2,#fff));backdrop-filter:blur(24px) saturate(1.4);box-shadow:var(--dsw-elevation-prominent,0 8px 30px #0003);color:var(--dsw-alias-label-primary)}\n.theone-foam-menu button{display:flex;width:100%;height:34px;align-items:center;padding:0 12px;border:0;border-radius:var(--dsw-radius-md,8px);background:none;color:inherit;font:inherit;font-size:13.5px;cursor:pointer;text-align:left}\n.theone-foam-menu button:hover,.theone-foam-menu button:focus-visible{background:var(--dsw-alias-interactive-bg-hover,#0000000a);outline:none}\n.theone-foam-menu hr{border:0;border-top:.5px solid var(--dsw-alias-border-l2,#8885);margin:4px 2px}\n@media(prefers-reduced-motion:reduce){.theone-cell [data-part=membrane],.theone-cell [data-part=body]{transition:none}}\n";

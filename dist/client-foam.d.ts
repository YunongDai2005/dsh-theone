/**
 * The topic cluster under TheOne's main-chat card: every topic is a round cell like the One mark, the cells
 * cling together like a raft of soap bubbles, and routing plays out on them (a message travels as a vesicle
 * into the topic it went to, new topics bud off the mark, answers travel back). Plain DOM and SVG; the host
 * feeds a model and routing events and receives the user's gestures as actions.
 */
/** idle, answering, waiting for a free slot, answered and not yet shown in main chat, waiting on the user (a question or approval), or failed/interrupted. */
export type FoamPhase = 'idle' | 'running' | 'queued' | 'answered' | 'waiting' | 'failed';
/**
 * What a topic is doing, as precisely as TheOne's state says, for its details and the all-topics list (the cell draws
 * only the phase): routing, starting, answering or recovering are all "running"; a question and an approval are both "waiting".
 */
export type FoamStatus = FoamPhase | 'routing' | 'starting' | 'recovering' | 'question' | 'approval';
/** Why a queued topic waits, when TheOne says. */
export type FoamQueueReason = 'host_queue' | 'capacity' | 'topic_busy' | 'project_busy' | 'handoff';
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
    /** The finer status for the topic's details; without it the phase stands in. */
    status?: FoamStatus;
    queueReason?: FoamQueueReason;
    /** Last activity (ms since epoch), for the order of the all-topics list. */
    lastActive?: number;
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
        state?: 'queued' | 'executing';
    }[];
    /** Finished merges that can still be taken apart, newest first: the target cell's menu offers to undo them. */
    merges?: {
        sourceId: string;
        targetId: string;
        title: string;
    }[];
    /** Possible duplicates TheOne keeps for the user to decide: a quiet dotted relation between the two cells. */
    suggestions?: FoamSuggestion[];
}
/** One possible duplicate: the pair, and both ways of merging it (source goes into target), TheOne's default first. */
export interface FoamSuggestion {
    id: string;
    a: string;
    b: string;
    directions: {
        sourceId: string;
        targetId: string;
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
}
/** Two topics became one. `undo`: offer the undo chip (a queued merge that just finished). */
 | {
    kind: 'merged';
    id: string;
    into: string;
    undo?: boolean;
}
/** A queued merge ended without merging (cancelled, expired or failed). */
 | {
    kind: 'mergeEnded';
    id: string;
    into: string;
    failed: boolean;
};
export type FoamTextKey = 'more' | 'running' | 'queued' | 'answered' | 'asking' | 'bond' | 'waiting' | 'failed' | 'menuAnswer' | 'offer' | 'rerouteBusy' | 'rerouteFailed' | 'actionFailed' | 'mergeFailed' | 'mergeHold' | 'undo' | 'menuCancelMerge' | 'menuUnmerge' | 'dropMain' | 'dropMerge' | 'dropMergeLater' | 'dropSession' | 'busyFling' | 'currentFling' | 'menuContinue' | 'menuOpen' | 'menuAside' | 'menuDelete' | 'menuStop' | 'menuCancel' | 'menuShowNow' | 'menuWorkspace' | 'menuReroute' | 'allTopics' | 'allWaiting' | 'filter' | 'noMatch' | 'statusCurrent' | 'statusAside' | 'statusRouting' | 'statusStarting' | 'statusRunning' | 'statusRecovering' | 'statusQueued' | 'queueCapacity' | 'queueTopic' | 'queueProject' | 'statusAnswered' | 'statusQuestion' | 'statusApproval' | 'statusWaiting' | 'statusFailed' | 'dupMenu' | 'dupTip' | 'dupTitle' | 'dupInto' | 'dupNo' | 'dupLater';
export interface FoamActions {
    mount(id: string): void;
    /** Merge `id` into `into`: merged now, queued until TheOne is free, or refused. */
    merge(id: string, into: string): Promise<'merged' | 'queued' | 'failed'>;
    /** Cancel a queued merge of `id`. */
    /** Cancel a queued merge of `id`; resolves to whether TheOne cancelled it. */
    cancelMerge(id: string): Promise<boolean>;
    /** Take a finished merge apart; resolves to whether TheOne did it. */
    unmerge(sourceId: string): Promise<boolean>;
    /**
     * Answer a possible duplicate: accept merges in the chosen direction (merged now, queued, or refused),
     * decline says they are not the same thing, later leaves it pending. Resolves to the outcome.
     */
    answerSuggestion(id: string, response: 'accept' | 'decline' | 'later', direction?: {
        sourceId: string;
        targetId: string;
    }): Promise<'merged' | 'queued' | 'done' | 'failed'>;
    attach(id: string, sessionId: string): Promise<boolean>;
    /** Declare the topic done for now; resolves to whether TheOne accepted it. */
    putAside(id: string): Promise<boolean>;
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
/**
 * Invisible hit circles for the cells: each at least `min` (half of 24 CSS px) where there is room, never into a
 * neighbour's (the free space between two cells is split by their own sizes), never past the cluster box (so it
 * covers nothing of DSH outside it), and never smaller than `floor`, the part of the cell's own outline it must
 * keep (default its radius). Returns one radius per item.
 */
export declare function foamHitRadii(items: {
    x: number;
    y: number;
    r: number;
    floor?: number;
}[], box?: {
    w: number;
    h: number;
}, min?: number): number[];
/** Which item a point means: among those whose circle holds it, the one with the nearest centre; -1 for none. */
export declare function foamNearest(p: {
    x: number;
    y: number;
}, items: {
    x: number;
    y: number;
    r: number;
}[]): number;
export interface FoamBox {
    left: number;
    top: number;
    right: number;
    bottom: number;
}
export interface FoamPlaceOptions {
    /** The side tried first; flips to the other when it does not fit. */
    side?: 'above' | 'below';
    /** Centred on the anchor (a hint), or starting at its left edge and flipping to end at its right edge (a menu at the pointer). */
    align?: 'center' | 'start';
    gap?: number;
    /** Kept free at every viewport edge. */
    margin?: number;
}
/** Where a floating box of `size` goes next to `anchor` so it stays whole inside the viewport on all four sides. */
export declare function foamPlace(size: {
    w: number;
    h: number;
}, anchor: FoamBox, view: {
    w: number;
    h: number;
}, opts?: FoamPlaceOptions): {
    left: number;
    top: number;
    side: 'above' | 'below';
};
/** Places a fixed-position element next to `anchor` within the viewport (see `foamPlace`); returns where it went. */
export declare function foamClampToViewport(el: HTMLElement, anchor: FoamBox, opts?: FoamPlaceOptions): {
    left: number;
    top: number;
    side: "above" | "below";
};
/**
 * Keyboard for a menu-like popover: Up/Down move between its items (wrapping), Home/End jump to the first/last,
 * Enter/Space activate, Escape and Tab call `close`. Returns a function that removes the handler.
 */
export declare function foamMenuKeys(el: HTMLElement, close: () => void, items?: string): () => void;
/** A topic's short status in words for its details and the all-topics list; empty for a plain idle topic. Says only what TheOne's state supports. */
export declare function foamStatusText(topic: Pick<FoamTopic, 'phase' | 'status' | 'queueReason' | 'current' | 'aside'>, text: (key: FoamTextKey) => string): string;
/**
 * The all-topics list's order: the topic main chat is in, then the ones doing something, then the rest, set-aside
 * topics last; most recent first within each, ties by name, so the order is the same every time it opens.
 */
export declare function foamOrder(topics: readonly FoamTopic[]): FoamTopic[];
/** Type-to-filter: a plain, case-insensitive substring of the title or the short label. Read-only. */
export declare function foamFilter<T extends Pick<FoamTopic, 'title' | 'label'>>(topics: readonly T[], query: string): T[];
export declare function createFoam(options: FoamOptions): Foam;
/** Colours follow the main card: warm tint and accent in light, blue in dark; idle cells take the sidebar's own fill. */
export declare const foamCss = "\n.theone-foam{position:fixed;left:0;top:0;width:0;height:8px;z-index:20;pointer-events:none;--foam-bg:var(--dsw-specific-sidebar-fill,#f7f7f5);--foam-tint:#fff5ec;--foam-accent:#a75b1e;--foam-heat:#ff7800;--foam-line:#c99267;--foam-done:#ffffff;--foam-idle-line:#d8d3ca;--foam-idle-dot:#cdb8a3;--foam-queue-line:#c4c1b8;--foam-queue-ink:#9a988f;--foam-fail:#b9785f;--foam-text:var(--dsw-alias-label-primary,#2b2b2b);--foam-muted:var(--dsw-alias-label-secondary,#8a8a86)}\n[data-ds-dark-theme] .theone-foam{--foam-bg:var(--dsw-specific-sidebar-fill,#1f1f22);--foam-tint:#1d2a37;--foam-accent:#93c8f3;--foam-heat:#80caff;--foam-line:#5d87ab;--foam-done:#2b2b30;--foam-idle-line:#4a515a;--foam-idle-dot:#5a7086;--foam-queue-line:#4d555e;--foam-queue-ink:#7f8a94;--foam-fail:#c98a74}\n.theone-foam>svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}\n.theone-foam-list{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}\n.theone-cell{cursor:grab;pointer-events:auto}\n.theone-cell.drag{cursor:grabbing}\n.theone-cell [data-part=hit]{fill:transparent;stroke:none;pointer-events:all}\n.theone-cell [data-part=body]{stroke:none;fill:var(--foam-bg);transition:fill .8s ease}\n.theone-cell [data-part=membrane]{fill:none;stroke:var(--foam-idle-line);stroke-width:1.2;stroke-linejoin:round;stroke-linecap:round;transition:stroke .8s ease,stroke-width .4s ease}\n.theone-cell [data-part=nucleus]{fill:var(--foam-idle-dot);transition:fill .6s ease,stroke .6s ease}\n.theone-cell text{fill:var(--foam-muted);text-anchor:middle;dominant-baseline:middle;pointer-events:none;user-select:none;letter-spacing:.02em;transition:fill .6s ease}\n.theone-cell.running [data-part=body],.theone-cell.queued [data-part=body]{fill:var(--foam-tint)}\n.theone-cell.running [data-part=membrane]{stroke:var(--foam-line);stroke-width:1.3}\n.theone-cell.running [data-part=nucleus],.theone-cell.done [data-part=nucleus]{fill:var(--foam-accent)}\n.theone-cell.running text,.theone-cell.done text{fill:var(--foam-text)}\n.theone-cell.done [data-part=body]{fill:var(--foam-done)}\n.theone-cell.done [data-part=membrane]{stroke:var(--foam-line);stroke-width:1.3}\n.theone-cell.queued [data-part=membrane]{stroke:var(--foam-queue-line)}\n.theone-cell.queued [data-part=nucleus]{fill:transparent;stroke:var(--foam-queue-ink);stroke-width:1}\n.theone-cell.queued text{fill:var(--foam-queue-ink)}\n.theone-cell.wait [data-part=body]{fill:var(--foam-tint)}\n.theone-cell.wait [data-part=membrane]{stroke:var(--foam-accent);stroke-width:1.4}\n.theone-cell.wait [data-part=nucleus]{fill:transparent;stroke:var(--foam-accent);stroke-width:1.4}\n.theone-cell.wait text{fill:var(--foam-text)}\n.theone-cell.fail [data-part=membrane]{stroke:var(--foam-fail);stroke-dasharray:1.5 2.5}\n.theone-cell.fail [data-part=nucleus]{fill:transparent;stroke:var(--foam-fail);stroke-width:1.2}\n.theone-cell.fail text{fill:var(--foam-fail)}\n.theone-cell.cur [data-part=body]{fill:var(--foam-tint)}\n.theone-cell.cur [data-part=membrane]{stroke:var(--foam-accent);stroke-width:1.4}\n.theone-cell.cur [data-part=nucleus]{fill:var(--foam-accent)}\n.theone-cell.cur text{fill:var(--foam-accent)}\n.theone-cell.lit [data-part=membrane]{stroke:var(--foam-accent);stroke-width:1.6;transition-duration:.15s}\n.theone-cell.ask [data-part=membrane]{stroke:var(--foam-accent);stroke-dasharray:3 3}\n.theone-cell.fuse [data-part=membrane]{stroke:var(--foam-accent);stroke-width:1.6}\n.theone-cell.more{cursor:pointer}\n.theone-cell.offer{cursor:pointer}\n.theone-cell.offer [data-part=membrane]{stroke:var(--foam-line)}\n.theone-cell.offer [data-part=nucleus]{fill:var(--foam-accent)}\n.theone-cell.pending [data-part=membrane]{stroke:var(--foam-accent);stroke-dasharray:2 3;animation:theone-foam-march 1s linear infinite}\n@keyframes theone-foam-march{to{stroke-dashoffset:-10}}\n.theone-foam-undo{position:fixed;z-index:1000;transform:translate(-50%,3px);padding:3px 10px;border:.5px solid var(--dsw-alias-border-l2,#8885);border-radius:999px;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#2b2b2b);font:inherit;font-size:12px;line-height:1.5;cursor:pointer;opacity:0;pointer-events:none;transition:opacity .15s,transform .15s}\n.theone-foam-undo.on{opacity:1;pointer-events:auto;transform:translate(-50%,0)}\n.theone-cell.more [data-part=membrane]{stroke-dasharray:1.2 3}\n.theone-neck [data-part=edge]{fill:none;stroke:var(--foam-line);stroke-width:1.3;stroke-linecap:round}\n.theone-dup-thread{fill:none;stroke:var(--foam-line);stroke-width:1.2;stroke-linecap:round;stroke-dasharray:0 3.4;pointer-events:none}\n.theone-dup-thread.open{stroke:var(--foam-accent)}\n.theone-dup{cursor:pointer}\n.theone-dup [data-part=hit]{fill:none;stroke:none;pointer-events:all}\n.theone-dup [data-part=ring]{fill:var(--foam-bg);stroke:var(--foam-line);stroke-width:1.1;stroke-linecap:round;stroke-dasharray:0 2.5;pointer-events:none;transition:stroke .2s ease}\n.theone-dup:hover [data-part=ring],.theone-dup.open [data-part=ring]{stroke:var(--foam-accent)}\n.theone-foam-dup{width:max-content;max-width:min(260px,calc(100vw - 16px))}\n.theone-foam-dup-head{padding:6px 12px 4px}\n.theone-foam-dup-title{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary,#8a8a86)}\n.theone-foam-dup-name{font-size:13.5px;line-height:1.4;padding:2px 0;white-space:normal;overflow-wrap:anywhere}\n.theone-foam-menu.theone-foam-dup button{height:auto;min-height:34px;padding:7px 12px;line-height:1.35;white-space:normal;overflow-wrap:anywhere}\n.theone-vesicle [data-part=membrane]{fill:var(--foam-tint);stroke:var(--foam-accent);stroke-width:1.1}\n.theone-vesicle [data-part=nucleus]{fill:var(--foam-accent)}\nhtml[data-theone-foam] button:has(.theone-workspace-entry){display:none}\n[data-row-key][data-theone-drop=true]{background:color-mix(in srgb,#ff7800 10%,transparent);box-shadow:inset 0 0 0 1px color-mix(in srgb,#a75b1e 40%,transparent);border-radius:10px}\n.theone-foam-tip{position:fixed;z-index:1000;padding:4px 8px;border-radius:7px;background:var(--dsw-alias-label-primary,#2e2d2a);color:var(--dsw-alias-bg-base,#f4f3ef);font-size:11.5px;line-height:1.5;max-width:min(240px,calc(100vw - 16px));box-sizing:border-box;white-space:normal;overflow-wrap:anywhere;pointer-events:none;opacity:0;transform:translateY(3px);transition:opacity .12s,transform .12s}\n.theone-foam-tip[data-side=below]{transform:translateY(-3px)}\n.theone-foam-tip.on{opacity:1;transform:none}\n.theone-foam-menu{position:fixed;z-index:1000;box-sizing:border-box;min-width:168px;max-width:min(320px,calc(100vw - 16px));max-height:calc(100vh - 16px);overflow-y:auto;overscroll-behavior:contain;padding:4px;border:.5px solid var(--dsw-alias-border-l2,#8885);border-radius:var(--dsw-radius-lg,12px);background:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-2,#fff));backdrop-filter:blur(24px) saturate(1.4);box-shadow:var(--dsw-elevation-prominent,0 8px 30px #0003);color:var(--dsw-alias-label-primary)}\n.theone-foam-menu button{display:flex;width:100%;min-height:34px;align-items:center;padding:7px 12px;line-height:1.4;white-space:normal;overflow-wrap:anywhere;border:0;border-radius:var(--dsw-radius-md,8px);background:none;color:inherit;font:inherit;font-size:13.5px;cursor:pointer;text-align:left}\n.theone-foam-menu button:hover,.theone-foam-menu button:focus-visible{background:var(--dsw-alias-interactive-bg-hover,#0000000a);outline:none}\n.theone-foam-menu hr{border:0;border-top:.5px solid var(--dsw-alias-border-l2,#8885);margin:4px 2px}\n.theone-foam-all{position:absolute;right:6px;bottom:0;display:flex;align-items:center;gap:2px;height:18px;min-width:24px;padding:0 4px;border:0;border-radius:6px;background:none;color:var(--foam-idle-line);font:inherit;font-size:10.5px;line-height:1;font-variant-numeric:tabular-nums;cursor:pointer;pointer-events:auto;transition:color .3s ease}\n.theone-foam-all[hidden]{display:none}\n.theone-foam.rail .theone-foam-all{right:auto;left:50%;transform:translateX(-50%)}\n.theone-foam-all svg{width:18px;height:12px;overflow:visible}\n.theone-foam-all circle{fill:var(--foam-bg);stroke:currentColor;stroke-width:1.1}\n.theone-foam-all:hover{color:var(--foam-line)}\n.theone-foam-all:focus-visible{outline:1.5px solid var(--foam-accent);outline-offset:1px;color:var(--foam-line)}\n.theone-foam-all.need{color:var(--foam-accent)}\n.theone-foam-all span:empty{display:none}\n.theone-foam-pop{--foam-accent:#a75b1e;width:max-content;max-width:min(280px,calc(100vw - 16px));overflow:auto;overscroll-behavior:contain;box-sizing:border-box}\n[data-ds-dark-theme] .theone-foam-pop{--foam-accent:#93c8f3}\n.theone-foam-pop button{height:auto;min-height:34px;padding-top:6px;padding-bottom:6px;line-height:1.35}\n.theone-foam-head{padding:8px 12px 6px;display:flex;flex-direction:column;gap:2px}\n.theone-foam-name{font-size:13.5px;line-height:1.4;white-space:normal;overflow-wrap:anywhere}\n.theone-foam-head .theone-foam-name{font-weight:600}\n.theone-foam-status{font-size:12px;line-height:1.4;color:var(--dsw-alias-label-secondary,#8a8a86)}\n.theone-foam-status.need{color:var(--foam-accent)}\n.theone-foam-pop .theone-foam-primary{color:var(--foam-accent);font-weight:600}\n.theone-foam-all-list{width:min(280px,calc(100vw - 16px));display:flex;flex-direction:column;overflow:hidden}\n.theone-foam-filter{flex:none;width:100%;box-sizing:border-box;height:30px;margin:0 0 4px;padding:0 10px;border:.5px solid var(--dsw-alias-border-l2,#8885);border-radius:var(--dsw-radius-md,8px);background:transparent;color:inherit;font:inherit;font-size:13px;outline:none}\n.theone-foam-filter:focus-visible{border-color:var(--foam-accent)}\n.theone-foam-rows{flex:1 1 auto;min-height:0;overflow:auto;overscroll-behavior:contain}\n.theone-foam-pop .theone-foam-row{flex-direction:column;align-items:flex-start;justify-content:center;gap:1px}\n.theone-foam-row[aria-current=true] .theone-foam-name{color:var(--foam-accent)}\n.theone-foam-empty{display:block;padding:6px 12px;font-size:12.5px;color:var(--dsw-alias-label-secondary,#8a8a86)}\n.theone-foam-empty[hidden]{display:none}\n.theone-foam-all-list>hr,.theone-foam-all-list>button{flex:none}\n@media(prefers-reduced-motion:reduce){.theone-foam-all{transition:none}.theone-cell [data-part=membrane],.theone-cell [data-part=body]{transition:none}.theone-cell.pending [data-part=membrane]{animation:none}.theone-foam-undo,.theone-foam-tip{transition:none}.theone-dup [data-part=ring]{transition:none}}\n";

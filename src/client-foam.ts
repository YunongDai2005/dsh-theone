/**
 * The topic cluster under TheOne's main-chat card: every topic is a round cell like the One mark, the cells
 * cling together like a raft of soap bubbles, and routing plays out on them (a message travels as a vesicle
 * into the topic it went to, new topics bud off the mark, answers travel back). Plain DOM and SVG; the host
 * feeds a model and routing events and receives the user's gestures as actions.
 */

/** idle, answering, waiting for a free slot, answered and not yet shown in main chat, waiting on the user (a question or approval), or failed/interrupted. */
export type FoamPhase = 'idle' | 'running' | 'queued' | 'answered' | 'waiting' | 'failed'

export interface FoamTopic {
  id: string
  title: string
  /** A short name for the cell when the title is too long (e.g. the topic's main keyword); the full title shows on hover. */
  label?: string
  /** 0..1, how recently and often the topic was used; bigger and higher up when recent. */
  weight: number
  phase: FoamPhase
  /** Main chat is attached to this topic. */
  current?: boolean
  /** A clarifying question in main chat names this topic as one of the candidates. */
  asking?: boolean
  /** The user set it aside (TheOne's "done"); it waits in the fold until a message reaches it again. */
  aside?: boolean
  /** A one-off aside question: small, and folds away once answered. */
  oneOff?: boolean
  /** Topic workspace id; topics of one workspace stick together. */
  group?: string
  /** When the current run started (ms since epoch), for the running hint. */
  startedAt?: number
}

export interface FoamModel {
  topics: FoamTopic[]
  /** Learned or manual relatedness between topics, 0..1 (negative: the user kept them apart). */
  links?: { a: string; b: string; weight: number }[]
  /** Merges waiting for the topics to go quiet. */
  pendingMerges?: { id: string; into: string }[]
  /** Finished merges that can still be taken apart, newest first: the target cell's menu offers to undo them. */
  merges?: { sourceId: string; targetId: string; title: string }[]
}

export type FoamEvent =
  /** A message settled on a topic; `alternates` were the other close candidates, they only flicker. */
  | { kind: 'route'; to: string; related?: string[]; alternates?: string[]; messageId?: string }
  /** More input for a topic that is already answering (steering). */
  | { kind: 'supplement'; to: string }
  | { kind: 'create'; to: string }
  /** Routing is truly blocked and needs the user: the vesicle waits between the candidates. */
  | { kind: 'clarify'; candidates: string[] }
  | { kind: 'resolve'; to?: string }
  | { kind: 'correct'; from: string; to: string }
  | { kind: 'merged'; id: string; into: string }

export type FoamTextKey =
  | 'more' | 'running' | 'queued' | 'answered' | 'asking' | 'bond' | 'waiting' | 'failed' | 'menuAnswer' | 'offer' | 'rerouteBusy' | 'rerouteFailed' | 'actionFailed' | 'mergeFailed' | 'mergeHold' | 'undo' | 'menuCancelMerge' | 'menuUnmerge'
  | 'dropMain' | 'dropMerge' | 'dropMergeLater' | 'dropSession' | 'busyFling' | 'currentFling'
  | 'menuContinue' | 'menuOpen' | 'menuAside' | 'menuDelete' | 'menuStop' | 'menuCancel' | 'menuShowNow' | 'menuWorkspace'

export interface FoamActions {
  mount(id: string): void
  /** Merge `id` into `into`: merged now, queued until TheOne is free, or refused. */
  merge(id: string, into: string): Promise<'merged' | 'queued' | 'failed'>
  /** Cancel a queued merge of `id`. */
  cancelMerge(id: string): void
  /** Take a finished merge apart; resolves to whether TheOne did it. */
  unmerge(sourceId: string): Promise<boolean>
  attach(id: string, sessionId: string): Promise<boolean>
  /** Declare the topic done for now; resolves to whether TheOne accepted it. */
  putAside(id: string): Promise<boolean>
  open(id: string): void
  stop(id: string): void
  cancelQueued(id: string): void
  remove(id: string): void
  showAnswer(id: string): void
  /** Move a message routing hesitated over into the topic the user picked; resolves to the HTTP status. */
  reroute(messageId: string, to: string): Promise<number>
  /** Go to where the topic waits on the user (its question or approval in main chat). */
  answer(id: string): void
  openWorkspace(): void
  text(key: FoamTextKey, vars?: Record<string, string | number>): string
}

export interface FoamOptions {
  /** Absolutely positioned box right under the main card; the cells are drawn in it and may overflow upward over the card. */
  host: HTMLElement
  /** The One mark in the main card: messages leave from it and answers return to it. */
  mark: () => Element | null
  /** The sidebar: a cell thrown past its edge is set aside. */
  side: () => Element | null
  actions: FoamActions
  /** The cluster's height changed; the host makes room for it. */
  onHeight(height: number): void
  /** Called at the start of every frame, so the host can keep the box aligned under the card. */
  place?(): void
  /** How much the mark should swell right now (0..1): a message left, or an answer arrived. */
  onPulse?(amount: number): void
  /** The sidebar starts collapsed: begin with the small cells instead of shrinking into them. */
  rail?: boolean
}

export interface Foam {
  update(model: FoamModel): void
  event(event: FoamEvent): void
  setRail(on: boolean): void
  destroy(): void
}

const NS = 'http://www.w3.org/2000/svg'
const MAX_VISIBLE = 14, N = 48, GAP = 2, SOFT = 2.2, MINI = .32, MARK_R = 7.4
const fx = (v: number) => v.toFixed(2)
const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v))
const ease = (v: number, target: number, rate: number, dt: number) => v + (target - v) * Math.min(1, dt * rate)
const now = () => performance.now()
interface Pt { x: number; y: number }

function curve(p: number[][]): string {
  const n = p.length
  let d = `M${fx(p[0][0])} ${fx(p[0][1])}`
  for (let i = 0; i < n; i++) {
    const p0 = p[(i + n - 1) % n], p1 = p[i], p2 = p[(i + 1) % n], p3 = p[(i + 2) % n]
    d += `C${fx(p1[0] + (p2[0] - p0[0]) / 6)} ${fx(p1[1] + (p2[1] - p0[1]) / 6)} ${fx(p2[0] - (p3[0] - p1[0]) / 6)} ${fx(p2[1] - (p3[1] - p1[1]) / 6)} ${fx(p2[0])} ${fx(p2[1])}`
  }
  return d + 'Z'
}
/** Smooth minimum: where two cells meet, the contact face bends into rounded corners like a bubble wall. */
const smin = (a: number, b: number, k: number) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k / 4 }
function polygonArea(p: number[][]): number {
  let s = 0
  for (let i = 0; i < p.length; i++) { const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length]; s += x1 * y2 - x2 * y1 }
  return Math.abs(s) / 2
}

/** A membrane neck between two round bodies: budding off the mark, two topics fusing, or a pending merge. */
function bridge(c1: Pt, r1: number, c2: Pt, r2: number, reach = r2 * 2.5, v = .5, hs = 2.4): { edge: string; fill: string } | null {
  const d = Math.hypot(c2.x - c1.x, c2.y - c1.y), maxD = r1 + reach
  if (r1 <= 0 || r2 <= 0 || d > maxD || d <= Math.abs(r1 - r2)) return null
  let u1 = 0, u2 = 0
  if (d < r1 + r2) {
    u1 = Math.acos(clamp((r1 * r1 + d * d - r2 * r2) / (2 * r1 * d), -1, 1))
    u2 = Math.acos(clamp((r2 * r2 + d * d - r1 * r1) / (2 * r2 * d), -1, 1))
  }
  const ab = Math.atan2(c2.y - c1.y, c2.x - c1.x), spread = Math.acos(clamp((r1 - r2) / d, -1, 1))
  const a1 = ab + u1 + (spread - u1) * v, a2 = ab - u1 - (spread - u1) * v
  const a3 = ab + Math.PI - u2 - (Math.PI - u2 - spread) * v, a4 = ab - Math.PI + u2 + (Math.PI - u2 - spread) * v
  const P = (c: Pt, a: number, r: number) => [c.x + r * Math.cos(a), c.y + r * Math.sin(a)]
  const p1 = P(c1, a1, r1), p2 = P(c1, a2, r1), p3 = P(c2, a3, r2), p4 = P(c2, a4, r2)
  const tot = r1 + r2, k = Math.min(v * hs, Math.hypot(p1[0] - p3[0], p1[1] - p3[1]) / tot) * Math.min(1, d * 2 / tot)
  const H = (p: number[], a: number, r: number) => [p[0] + r * Math.cos(a), p[1] + r * Math.sin(a)]
  const h1 = H(p1, a1 - Math.PI / 2, r1 * k), h2 = H(p2, a2 + Math.PI / 2, r1 * k), h3 = H(p3, a3 + Math.PI / 2, r2 * k), h4 = H(p4, a4 - Math.PI / 2, r2 * k)
  const s = (p: number[]) => fx(p[0]) + ' ' + fx(p[1])
  return { edge: `M${s(p1)}C${s(h1)} ${s(h3)} ${s(p3)}M${s(p4)}C${s(h4)} ${s(h2)} ${s(p2)}`,
    fill: `M${s(p1)}C${s(h1)} ${s(h3)} ${s(p3)}L${s(p4)}C${s(h4)} ${s(h2)} ${s(p2)}Z` }
}

/**
 * The name a cell can carry: the topic's own short label when it has one, else the title up to its first
 * punctuation ("想去日本旅游，帮我看看行程" → "想去日本旅游"). Always a whole phrase, never cut mid-word.
 */
export function foamShortName(title: string, label?: string): string {
  if (label?.trim()) return label.trim()
  const head = title.split(/[，,。.？?！!：:；;、（）()【】[\]—\-|/]/).map(part => part.trim()).find(Boolean)
  return head ?? title.trim()
}

/** How a name sits in a cell: one line if it fits, else two (big cells: three) balanced lines, else no text. Never a clipped name. */
export function foamLabel(name: string, radius: number): { lines: string[]; font: number; lh: number } {
  const chars = [...name], big = radius >= 25 ? 10.5 : 9.5, small = radius >= 25 ? 9.5 : 8.8
  // A Latin letter takes about 0.6 of a CJK character's width.
  const width = (s: string[]) => s.reduce((w, ch) => w + (/[⺀-￿]/.test(ch) ? 1 : .6), 0)
  const tries: [number, number][] = [[1, big], [1, small], [2, big], [2, small], [3, small]]
  for (const [lines, font] of tries) {
    if (lines === 1 && font === small && width(chars) > 3 && radius < 25) continue
    if (lines === 2 && (chars.length < 4 || width(chars) > 8)) continue
    if (lines === 3 && (radius < 25 || chars.length < 7 || width(chars) > 9)) continue
    const lh = font * 1.18, per = Math.ceil(chars.length / lines)
    const parts = Array.from({ length: lines }, (_, i) => chars.slice(i * per, (i + 1) * per)).filter(p => p.length)
    const widest = Math.max(...parts.map(width)) * font
    if (widest > 2 * radius * (lines === 1 ? .8 : lines === 2 ? .74 : .7) - 4 || (lines === 3 ? 6 : 9) + parts.length * lh > 2 * radius * .86) continue
    return { lines: parts.map(p => p.join('')), font, lh }
  }
  return { lines: [], font: big, lh: 0 }
}

/**
 * Invisible hit circles for the cells: each at least `min` (half of 24 CSS px) where there is room, never into a
 * neighbour's (the free space between two cells is split by their own sizes), never past the cluster box (so it
 * covers nothing of DSH outside it), and never smaller than `floor`, the part of the cell's own outline it must
 * keep (default its radius). Returns one radius per item.
 */
export function foamHitRadii(items: { x: number; y: number; r: number; floor?: number }[], box?: { w: number; h: number }, min = 12): number[] {
  const floor = items.map(a => Math.max(0, a.floor ?? a.r))
  const dist = (i: number, j: number) => Math.hypot(items[j].x - items[i].x, items[j].y - items[i].y)
  const h = items.map((a, i) => {
    let v = Math.max(a.r, min)
    for (let j = 0; j < items.length; j++) if (j !== i) v = Math.min(v, a.r + (dist(i, j) - a.r - items[j].r) / 2)
    if (box) v = Math.min(v, a.x, box.w - a.x, a.y, box.h - a.y)
    return Math.max(v, floor[i])
  })
  // A circle held up by its floor may still reach into a neighbour's: both give way, each down to its own floor at most.
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const over = h[i] + h[j] - dist(i, j), si = h[i] - floor[i], sj = h[j] - floor[j]
    if (over <= 0 || si + sj <= 0) continue
    const k = Math.min(1, over / (si + sj))
    h[i] -= si * k; h[j] -= sj * k
  }
  return h
}

/** Which item a point means: among those whose circle holds it, the one with the nearest centre; -1 for none. */
export function foamNearest(p: { x: number; y: number }, items: { x: number; y: number; r: number }[]): number {
  let best = -1, bestD = Infinity
  items.forEach((a, i) => { const d = Math.hypot(p.x - a.x, p.y - a.y); if (d <= a.r && d < bestD) { best = i; bestD = d } })
  return best
}

export interface FoamBox { left: number; top: number; right: number; bottom: number }
export interface FoamPlaceOptions {
  /** The side tried first; flips to the other when it does not fit. */
  side?: 'above' | 'below'
  /** Centred on the anchor (a hint), or starting at its left edge and flipping to end at its right edge (a menu at the pointer). */
  align?: 'center' | 'start'
  gap?: number
  /** Kept free at every viewport edge. */
  margin?: number
}

/** Where a floating box of `size` goes next to `anchor` so it stays whole inside the viewport on all four sides. */
export function foamPlace(size: { w: number; h: number }, anchor: FoamBox, view: { w: number; h: number }, opts: FoamPlaceOptions = {}): { left: number; top: number; side: 'above' | 'below' } {
  const m = opts.margin ?? 8, g = opts.gap ?? 6, { w, h } = size
  const above = anchor.top - g - h, below = anchor.bottom + g
  const fitsAbove = above >= m, fitsBelow = below + h <= view.h - m
  let side = opts.side ?? 'above'
  if (side === 'above' ? !fitsAbove : !fitsBelow) {
    if (side === 'above' ? fitsBelow : fitsAbove) side = side === 'above' ? 'below' : 'above'
    else side = anchor.top - m >= view.h - m - anchor.bottom ? 'above' : 'below'
  }
  const top = Math.max(m, Math.min(side === 'above' ? above : below, view.h - m - h))
  let left = opts.align === 'start' ? anchor.left : (anchor.left + anchor.right) / 2 - w / 2
  if (opts.align === 'start' && left + w > view.w - m) left = anchor.right - w
  left = Math.max(m, Math.min(left, view.w - m - w))
  return { left, top, side }
}

/** Places a fixed-position element next to `anchor` within the viewport (see `foamPlace`); returns where it went. */
export function foamClampToViewport(el: HTMLElement, anchor: FoamBox, opts: FoamPlaceOptions = {}) {
  el.style.left = '0px'; el.style.top = '0px'
  const r = el.getBoundingClientRect(), root = document.documentElement
  const p = foamPlace({ w: r.width, h: r.height }, anchor, { w: root.clientWidth || innerWidth, h: root.clientHeight || innerHeight }, opts)
  el.style.left = p.left + 'px'; el.style.top = p.top + 'px'; el.dataset.side = p.side
  return p
}

/**
 * Keyboard for a menu-like popover: Up/Down move between its items (wrapping), Home/End jump to the first/last,
 * Enter/Space activate, Escape and Tab call `close`. Returns a function that removes the handler.
 */
export function foamMenuKeys(el: HTMLElement, close: () => void, items = '[role=menuitem]:not([disabled])'): () => void {
  const onKey = (e: KeyboardEvent) => {
    const list = Array.from(el.querySelectorAll<HTMLElement>(items)), at = list.indexOf(document.activeElement as HTMLElement)
    const go = (i: number) => { e.preventDefault(); e.stopPropagation(); list[(i + list.length) % list.length]?.focus() }
    if (e.key === 'ArrowDown') go(at < 0 ? 0 : at + 1)
    else if (e.key === 'ArrowUp') go(at < 0 ? list.length - 1 : at - 1)
    else if (e.key === 'Home') go(0)
    else if (e.key === 'End') go(list.length - 1)
    else if ((e.key === 'Enter' || e.key === ' ') && at >= 0) { e.preventDefault(); e.stopPropagation(); list[at].click() }
    else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); close() }
  }
  el.addEventListener('keydown', onKey)
  return () => el.removeEventListener('keydown', onKey)
}

type CellState = 'idle' | 'running' | 'queued' | 'done' | 'wait' | 'fail'
interface Cell {
  id: string; kind: 'topic' | 'more'; title: string; short?: string; state: CellState; cur: boolean; ask: boolean; aside: boolean; oneOff: boolean
  group?: string; w: number; startedAt?: number
  g: SVGGElement; gr: SVGRadialGradientElement; stop: SVGStopElement; b: SVGPathElement; h: SVGPathElement; m: SVGPathElement; n: SVGCircleElement; label: SVGTextElement
  neck: SVGGElement; nf: SVGPathElement; ne: SVGPathElement
  mode: 'bud' | 'live' | 'leave' | 'fling'; age: number; hidden: boolean; away: boolean; rebud: boolean; onBorn?: () => void; into?: Cell
  x: number; y: number; vx: number; vy: number; svx: number; svy: number; tx: number; ty: number; R: number; scale: number; alpha: number
  heat: number; solid: number; kick: number; flash: number; reveal: number; want: number; nx: number; ny: number; cx: number; cy: number
  offer?: { messageId: string; until: number }
  phase: number; shownKey: string; full: boolean; lay: { lines: string[]; font: number; lh: number }; showing: boolean
  /** The invisible hit circle under the outline, its radius, and the outline's nearest and farthest reach from the centre. */
  hc: SVGCircleElement; hit: number; vin: number; vr: number
}
interface Vesicle { el: SVGGElement; from: () => Pt; to: () => Pt; arrive: () => void; t: number; dur: number; hold: number | (() => boolean); toMark: boolean }

export function createFoam(options: FoamOptions): Foam {
  const { host, actions } = options
  // Read live, so switching reduced motion on takes effect without a reload.
  const motion = matchMedia('(prefers-reduced-motion: reduce)'), reduced = () => motion.matches
  host.classList.add('theone-foam')
  const svg = document.createElementNS(NS, 'svg')
  svg.setAttribute('aria-hidden', 'true')
  svg.innerHTML = '<defs></defs><g data-part="cells"></g><g data-part="necks"></g><g data-part="vesicles"></g>'
  host.appendChild(svg)
  const defs = svg.firstChild as SVGDefsElement, layer = svg.children[1] as SVGGElement, necks = svg.children[2] as SVGGElement, vlayer = svg.children[3] as SVGGElement
  const tip = document.createElement('div'); tip.className = 'theone-foam-tip'; document.body.appendChild(tip)
  // The cells are drawn, not focusable: a visually hidden list of buttons gives keyboard and screen-reader users the same topics.
  const list = document.createElement('div'); list.className = 'theone-foam-list'; list.setAttribute('role', 'list'); host.appendChild(list)
  const keys = new Map<string, HTMLButtonElement>()

  const cells: Cell[] = [], ves: Vesicle[] = []
  let links = new Map<string, number>(), bonds: [Cell, Cell][] = []
  let rail = !!options.rail, sz = rail ? MINI : 1, height = 8, heightTarget = -1, heightV = 0, pulse = 0, folded = 0, uid = 0, first = true
  let L: Pt = { x: 0, y: 0 }, ptr: Pt | null = null
  /** A press on a cell; it becomes a drag only after the pointer has really moved. A merge needs the pointer to rest on the other cell first. */
  let drag: { cell: Cell; dx: number; dy: number; trail: { x: number; y: number; t: number }[]; started: boolean; last: Pt; rest?: { cell: Cell; since: number } } | null = null
  let model: FoamModel = { topics: [] }
  const undo = document.createElement('button'); undo.type = 'button'; undo.className = 'theone-foam-undo'; document.body.appendChild(undo)
  let undoTimer = 0
  let target: { kind: 'main' } | { kind: 'cell'; cell: Cell } | { kind: 'session'; el: Element; id: string } | null = null
  let clarifying: { cells: Cell[]; ves?: Vesicle } | null = null
  let menu: HTMLDivElement | null = null, tipOwner: Cell | null = null, raf = 0, last = now(), t = 0
  const pending: FoamEvent[] = []

  const sizeOf = (c: Cell) => c.kind === 'more' ? 16 : c.oneOff ? 21 : c.state === 'running' || c.state === 'done' || c.state === 'wait' || c.state === 'fail' || c.cur ? 29 : c.state === 'queued' ? 24 : 16 + 9 * c.w
  /** At rest only the topics doing something carry a name; the rest are plain cells until the pointer comes near. */
  const named = (c: Cell) => c.kind === 'more' || c.cur || c.state !== 'idle' || c.ask || !!c.offer || c.mode === 'bud'
  const busy = (c: Cell) => c.state === 'running' || c.state === 'queued' || c.state === 'wait' || c.state === 'done'
  const topics = () => cells.filter(c => c.kind === 'topic' && c.mode !== 'leave')
  const byId = (id: string) => cells.find(c => c.kind === 'topic' && c.id === id && c.mode !== 'leave')
  const linkW = (c: Cell, o: Cell) => (c.group && c.group === o.group ? .8 : 0) + (links.get(c.id + '|' + o.id) ?? 0)
  const local = (e: { clientX: number; clientY: number }) => { const r = host.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top } }
  const pos = (c: Cell): Pt => ({ x: c.cx, y: c.cy })
  const markPos = (): Pt => ({ x: L.x, y: L.y })
  /** The cell a pointer at this client point means: of the shown cells whose hit circle or outline holds it, the nearest centre. */
  function cellAt(x: number, y: number, skip?: Cell, topicsOnly = false): Cell | undefined {
    const r = host.getBoundingClientRect()
    const list = cells.filter(o => o !== skip && o.mode === 'live' && !o.hidden && o.scale >= .02 && (!topicsOnly || o.kind === 'topic'))
    const i = foamNearest({ x: x - r.left, y: y - r.top }, list.map(o => ({ x: o.cx, y: o.cy, r: Math.max(o.hit, o.vr) })))
    return i < 0 ? undefined : list[i]
  }

  function makeCell(id: string, title: string, spawn: boolean): Cell {
    const gid = `theone-foam-${uid++}`
    const gr = document.createElementNS(NS, 'radialGradient')
    gr.id = gid; gr.setAttribute('r', '62%')
    gr.innerHTML = '<stop offset="0%" stop-color="var(--foam-heat)"/><stop offset="100%" stop-color="var(--foam-heat)" stop-opacity="0"/>'
    defs.appendChild(gr)
    const g = document.createElementNS(NS, 'g')
    g.setAttribute('class', 'theone-cell idle')
    g.innerHTML = `<path data-part="body"/><path data-part="heat" fill="url(#${gid})"/><path data-part="membrane"/><circle data-part="nucleus"/><text></text>`
    layer.appendChild(g)
    const neck = document.createElementNS(NS, 'g')
    neck.setAttribute('class', 'theone-neck'); neck.innerHTML = '<path data-part="fill"/><path data-part="edge"/>'
    necks.appendChild(neck)
    const hc = document.createElementNS(NS, 'circle'); hc.setAttribute('data-part', 'hit'); hc.setAttribute('r', '0')
    const w = host.clientWidth
    const c: Cell = { id, kind: 'topic', title, state: 'idle', cur: false, ask: false, aside: false, oneOff: false, w: .05, hc, hit: 0, vin: 0, vr: 0,
      g, gr, stop: gr.firstChild as SVGStopElement, b: g.children[0] as SVGPathElement, h: g.children[1] as SVGPathElement, m: g.children[2] as SVGPathElement,
      n: g.children[3] as SVGCircleElement, label: g.children[4] as SVGTextElement, neck, nf: neck.children[0] as SVGPathElement, ne: neck.children[1] as SVGPathElement,
      mode: spawn ? 'bud' : 'live', age: 0, hidden: false, away: false, rebud: false,
      x: spawn ? L.x : w / 2 + (Math.random() - .5) * 90, y: spawn ? L.y : 30 + Math.random() * 100, vx: 0, vy: 0, svx: 0, svy: 0, tx: 0, ty: 0,
      R: 20, scale: spawn ? .12 : 1, alpha: 1, heat: 0, solid: 1, kick: 0, flash: 0, reveal: 0, want: 0, nx: 0, ny: 0, cx: 0, cy: 0,
      phase: Math.random() * 6, shownKey: '', full: false, lay: { lines: [], font: 9.5, lh: 0 }, showing: false }
    // Drawn under the outline, so the outline looks the same; it only widens where a small cell can be pressed.
    g.insertBefore(hc, g.firstChild)
    let hover = 0
    g.addEventListener('pointerdown', e => {
      // Where hit areas and outlines meet, the press belongs to the cell whose centre is nearest.
      const o = cellAt(e.clientX, e.clientY) ?? c
      if (e.button || o.mode !== 'live' || o.kind === 'more') return
      e.preventDefault(); clearTimeout(hover); hideTip()
      const p = local(e)
      drag = { cell: o, dx: p.x - o.x, dy: p.y - o.y, trail: [{ x: e.clientX, y: e.clientY, t: now() }], started: false, last: { x: e.clientX, y: e.clientY } }
      o.tx = o.x; o.ty = o.y
      try { o.g.setPointerCapture(e.pointerId) } catch { /* Older engines: the window listeners still see the release. */ }
    })
    g.addEventListener('click', e => { if ((cellAt(e.clientX, e.clientY) ?? c).kind === 'more' && !drag) actions.openWorkspace() })
    // Hover only tells what the cell cannot show itself: a name that did not surface, or what a busy topic is doing.
    g.addEventListener('pointerenter', () => { if (drag) return; clearTimeout(hover); hover = window.setTimeout(() => { if (!drag) showTip(c) }, 420) })
    g.addEventListener('pointerleave', () => { clearTimeout(hover); if (tipOwner === c) hideTip() })
    g.addEventListener('contextmenu', e => { e.preventDefault(); clearTimeout(hover); hideTip(); openMenu(e.clientX, e.clientY, cellAt(e.clientX, e.clientY) ?? c) })
    cells.push(c)
    return c
  }
  const more = makeCell('', '+0', false)
  more.kind = 'more'; more.g.classList.add('more'); more.hidden = true; more.scale = 0

  function setState(c: Cell, state: CellState) {
    if (c.state === state) return
    c.g.classList.remove(c.state); c.state = state; c.g.classList.add(state)
  }
  function light(c: Cell, related: Cell[] = []) {
    c.flash = 1; c.kick = 1
    c.g.classList.add('lit'); window.setTimeout(() => c.g.classList.remove('lit'), 900)
    for (const o of related) { o.flash = Math.max(o.flash, .45); o.kick = Math.max(o.kick, .5) }
  }
  function vesicle(from: () => Pt, to: () => Pt, arrive: () => void, dur = .7, hold: Vesicle['hold'] = 0): Vesicle {
    const el = document.createElementNS(NS, 'g')
    el.setAttribute('class', 'theone-vesicle'); el.innerHTML = '<circle data-part="membrane" r="3.4"/><circle data-part="nucleus" r="1.3"/>'
    vlayer.appendChild(el)
    const v: Vesicle = { el, from, to, arrive, t: 0, dur, hold, toMark: false }
    ves.push(v)
    return v
  }
  /** A message reaches a topic: a vesicle carries it there; a folded topic first buds back out of the mark. */
  function routeTo(c: Cell, related: Cell[]) {
    pulse = Math.max(pulse, .55)
    if (c.hidden || c.scale < .3) { c.rebud = true; c.onBorn = () => light(c, related); return }
    vesicle(markPos, () => pos(c), () => light(c, related))
  }
  function fuse(c: Cell, into: Cell) {
    if (c.mode !== 'live' && c.mode !== 'bud') return
    c.mode = 'leave'; c.into = into; c.g.style.pointerEvents = 'none'
    bonds = bonds.filter(b => b[0] !== c && b[1] !== c)
  }
  function fade(c: Cell) {
    if (c.mode === 'leave') return
    c.mode = 'leave'; c.into = undefined; c.g.style.pointerEvents = 'none'
    bonds = bonds.filter(b => b[0] !== c && b[1] !== c)
  }

  function apply(event: FoamEvent): boolean {
    if (event.kind === 'route') {
      const c = byId(event.to); if (!c) return false
      // A blocked message that has now settled: the waiting vesicle goes to where it landed.
      if (clarifying) { apply({ kind: 'resolve', to: event.to }); return true }
      routeTo(c, (event.related ?? []).map(byId).filter((o): o is Cell => !!o && o !== c))
      // The other close candidates light up for a while: routing was not sure, and one click on one of them moves the message there.
      if (event.messageId) for (const o of cells) if (o.offer && o.offer.messageId !== event.messageId) clearOffer(o)
      for (const o of (event.alternates ?? []).map(byId)) if (o && o !== c && !o.hidden) {
        o.flash = Math.max(o.flash, .3); o.g.classList.add('ask')
        // Bright for a few seconds, then a quiet mark that stays until the next message is routed (or a minute passes).
        if (event.messageId) o.offer = { messageId: event.messageId, until: now() + 60000 }
        else window.setTimeout(() => { if (!o.ask && !o.offer) o.g.classList.remove('ask') }, 1400)
      }
    } else if (event.kind === 'supplement') {
      const c = byId(event.to); if (!c) return false
      if (!c.hidden) { const v = vesicle(markPos, () => pos(c), () => { c.kick = Math.max(c.kick, .5) }, .55); v.el.setAttribute('data-small', 'true') }
    } else if (event.kind === 'create') {
      const c = byId(event.to); if (!c) return false
      pulse = Math.max(pulse, .55)
      if (c.mode === 'bud') c.onBorn = () => light(c)
      else light(c)
    } else if (event.kind === 'clarify') {
      const list = event.candidates.map(byId).filter((c): c is Cell => !!c && !c.hidden).slice(0, 3)
      if (list.length < 2) return true
      endClarify()
      pulse = Math.max(pulse, .55)
      const mid = () => ({ x: list.reduce((s, c) => s + c.cx, 0) / list.length, y: list.reduce((s, c) => s + c.cy, 0) / list.length - 4 })
      clarifying = { cells: list }
      for (const c of list) { c.ask = true; c.g.classList.add('ask') }
      clarifying.ves = vesicle(markPos, mid, () => {}, .7, () => !clarifying || clarifying.cells !== list)
    } else if (event.kind === 'resolve') {
      const held = clarifying?.ves, from = held ? { x: held.el.transform.baseVal.consolidate()?.matrix.e ?? L.x, y: held.el.transform.baseVal.consolidate()?.matrix.f ?? L.y } : markPos()
      endClarify()
      const c = event.to ? byId(event.to) : undefined
      if (c) vesicle(() => from, () => pos(c), () => light(c), .45)
    } else if (event.kind === 'correct') {
      const a = byId(event.from), b = byId(event.to); if (!b) return false
      if (a && !a.hidden) { a.flash = 0; a.kick = .6; vesicle(() => pos(a), () => pos(b), () => light(b), .6) }
      else routeTo(b, [])
    } else if (event.kind === 'merged') {
      const a = byId(event.id), b = byId(event.into)
      if (a && a.mode === 'leave') return true
      if (a && b) fuse(a, b); else if (a) fade(a)
    }
    return true
  }
  function clearOffer(o: Cell) { o.offer = undefined; o.g.classList.remove('offer', 'pending'); if (!o.ask) o.g.classList.remove('ask') }
  function endClarify() {
    if (!clarifying) return
    for (const c of clarifying.cells) { c.ask = false; c.g.classList.remove('ask') }
    clarifying = null
  }

  function update(next: FoamModel) {
    model = next
    const seen = new Set<string>()
    for (const topic of model.topics) {
      seen.add(topic.id)
      let c = byId(topic.id)
      if (!c) c = makeCell(topic.id, topic.title, !first)
      const was = c.state
      c.title = topic.title; c.short = topic.label; c.w = clamp(topic.weight); c.group = topic.group; c.aside = !!topic.aside; c.oneOff = !!topic.oneOff; c.startedAt = topic.startedAt
      c.ask = c.ask || !!topic.asking; c.g.classList.toggle('ask', c.ask)
      if (c.cur !== !!topic.current) { c.cur = !!topic.current; c.g.classList.toggle('cur', c.cur) }
      const state: CellState = topic.phase === 'answered' ? 'done' : topic.phase === 'waiting' ? 'wait' : topic.phase === 'failed' ? 'fail' : topic.phase
      // The answer went to main chat: it travels back to the mark.
      if (was === 'done' && state !== 'done' && !c.hidden) {
        c.showing = true
        vesicle(() => pos(c!), markPos, () => { pulse = 1; c!.showing = false }, .6).toMark = true
      }
      if (was !== 'running' && state === 'running') c.kick = Math.max(c.kick, .8)
      if (was === 'running' && state === 'done') c.kick = 1
      setState(c, state)
    }
    for (const c of topics()) if (!seen.has(c.id)) fade(c)
    links = new Map()
    for (const link of model.links ?? []) { links.set(link.a + '|' + link.b, link.weight); links.set(link.b + '|' + link.a, link.weight) }
    bonds = (model.pendingMerges ?? []).map(m => [byId(m.id), byId(m.into)] as [Cell | undefined, Cell | undefined]).filter((b): b is [Cell, Cell] => !!b[0] && !!b[1])
    first = false
    syncList()
    for (let i = 0; i < pending.length;) { if (apply(pending[i])) pending.splice(i, 1); else i++ }
    if (pending.length > 20) pending.splice(0, pending.length - 20)
  }
  function describe(c: Cell): string {
    const status = c.state === 'running' ? text('running', { s: Math.max(0, Math.round((Date.now() - (c.startedAt ?? Date.now())) / 1000)) })
      : c.state === 'wait' ? text('waiting') : c.state === 'fail' ? text('failed') : c.state === 'queued' ? text('queued') : c.state === 'done' ? text('answered') : ''
    return status ? c.title + ' · ' + status : c.title
  }
  function syncList() {
    const shown = topics().filter(c => !c.aside || busy(c))
    for (const [id, el] of keys) if (!shown.some(c => c.id === id)) { el.remove(); keys.delete(id) }
    for (const c of shown) {
      let el = keys.get(c.id)
      if (!el) {
        const b = el = document.createElement('button')
        b.type = 'button'; b.setAttribute('role', 'listitem')
        b.addEventListener('focus', () => c.g.classList.add('fuse'))
        b.addEventListener('blur', () => c.g.classList.remove('fuse'))
        b.addEventListener('click', () => { if (!c.cur) actions.mount(c.id) })
        b.addEventListener('keydown', e => {
          if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); const r = c.m.getBoundingClientRect(); openMenu(r.left + r.width / 2, r.bottom, c, true) }
        })
        keys.set(c.id, b); list.appendChild(b)
      }
      el.textContent = describe(c)
      el.setAttribute('aria-current', c.cur ? 'true' : 'false')
    }
  }
  function event(e: FoamEvent) { if (!apply(e)) pending.push(e) }

  function text(key: FoamTextKey, vars?: Record<string, string | number>) { return actions.text(key, vars) }
  function tipText(c: Cell): string {
    if (c.kind === 'more') return text('more', { n: folded })
    const who = c.full ? '' : c.title + ' · '
    const b = bonds.find(x => x[0] === c || x[1] === c)
    if (b) return who + text('bond', { name: (b[0] === c ? b[1] : b[0]).title })
    if (c.offer) return who + text('offer')
    if (c.ask) return who + text('asking')
    if (c.state === 'wait') return who + text('waiting')
    if (c.state === 'fail') return who + text('failed')
    if (c.state === 'queued') return who + text('queued')
    if (c.state === 'done') return who + text('answered')
    if (c.state === 'running') return who + text('running', { s: Math.max(0, Math.round((Date.now() - (c.startedAt ?? Date.now())) / 1000)) })
    return c.full ? '' : c.title
  }
  /** A hint above what it is about (below when there is no room), whole inside the viewport, long names wrapped. */
  function placeTip(anchor: FoamBox, s: string) {
    if (!s) { tip.classList.remove('on'); return }
    tip.textContent = s; foamClampToViewport(tip, anchor, { side: 'above', align: 'center', gap: 6 }); tip.classList.add('on')
  }
  /** The pointer as an anchor: a hint clears the cursor whether it sits above or below it. */
  const pointerBox = (x: number, y: number): FoamBox => ({ left: x, right: x, top: y - 2, bottom: y + 18 })
  function showTip(c: Cell) {
    tipOwner = c
    placeTip(c.m.getBoundingClientRect(), tipText(c))
  }
  function hideTip() { tipOwner = null; tip.classList.remove('on') }
  const tipTimer = window.setInterval(() => { if (tipOwner) showTip(tipOwner) }, 500)

  /** The open menu's topic, what it was opened from (for focus to go back to), and its key handler. */
  let menuOf: { cell: Cell; back: HTMLElement | null; prev: Element | null; unkeys: () => void } | null = null
  /** `restore`: focus goes back to where the menu came from; 'gone': its topic went away, so not to that topic's row. */
  function closeMenu(restore: boolean | 'gone' = false) {
    const was = menuOf, had = menu
    menu?.remove(); menu = null; menuOf = null
    if (!had || !was) return
    was.unkeys()
    if (!restore) return
    const back = restore === true && was.back?.isConnected ? was.back : null
    const prev = was.prev instanceof HTMLElement && was.prev.isConnected && was.prev !== document.body && !had.contains(was.prev)
      && !(restore === 'gone' && was.prev === keys.get(was.cell.id)) ? was.prev : null
    const to = back ?? prev
    if (to) to.focus()
    else if (had.contains(document.activeElement)) (document.activeElement as HTMLElement).blur()
  }
  function openMenu(x: number, y: number, c: Cell, fromKeyboard = false) {
    const prev = document.activeElement
    closeMenu()
    const items: ([string, () => void] | null)[] = c.kind === 'more' ? [[text('menuWorkspace'), actions.openWorkspace]]
      : c.state === 'running' ? [[text('menuOpen'), () => actions.open(c.id)], null, [text('menuStop'), () => actions.stop(c.id)]]
      : c.state === 'queued' ? [[text('menuOpen'), () => actions.open(c.id)], [text('menuCancel'), () => actions.cancelQueued(c.id)]]
      : c.state === 'done' ? [[text('menuShowNow'), () => actions.showAnswer(c.id)], [text('menuOpen'), () => actions.open(c.id)]]
      : c.state === 'wait' ? [[text('menuAnswer'), () => actions.answer(c.id)], [text('menuOpen'), () => actions.open(c.id)]]
      : [[text('menuContinue'), () => actions.mount(c.id)], [text('menuOpen'), () => actions.open(c.id)], ...(c.cur ? [] : [[text('menuAside'), () => void actions.putAside(c.id).then(ok => { if (!ok) tipAt(c, text('actionFailed')) })] as [string, () => void]]),
        null, [text('menuDelete'), () => actions.remove(c.id)]]
    if (c.kind === 'topic') {
      const extra: ([string, () => void] | null)[] = []
      if (bonds.some(b => b[0] === c)) extra.push([text('menuCancelMerge'), () => actions.cancelMerge(c.id)])
      for (const m of (model.merges ?? []).filter(m => m.targetId === c.id).slice(0, 3)) extra.push([text('menuUnmerge', { name: m.title }), () => undoMerge(m.sourceId, c)])
      if (extra.length) items.push(null, ...extra)
    }
    const el = menu = document.createElement('div')
    el.className = 'theone-foam-menu'; el.setAttribute('role', 'menu')
    for (const item of items) {
      if (!item) { el.appendChild(document.createElement('hr')); continue }
      const row = document.createElement('button')
      row.type = 'button'; row.setAttribute('role', 'menuitem'); row.textContent = item[0]
      row.onclick = () => { closeMenu(fromKeyboard); item[1]() }
      el.appendChild(row)
    }
    document.body.appendChild(el)
    // From the keyboard the menu hangs off the cell itself; from the pointer it opens where the click was. Either way it stays whole on screen.
    const anchor: FoamBox = fromKeyboard ? c.m.getBoundingClientRect() : { left: x, right: x, top: y, bottom: y }
    foamClampToViewport(el, anchor, fromKeyboard ? { side: 'below', align: 'center', gap: 6 } : { side: 'below', align: 'start', gap: 2 })
    // Keyboard-opened, focus returns to the topic's row in the list; pointer-opened, to whatever had it before.
    menuOf = { cell: c, back: fromKeyboard ? keys.get(c.id) ?? null : null, prev, unkeys: foamMenuKeys(el, () => closeMenu(true)) }
    el.querySelector('button')?.focus()
  }
  const outside = (e: PointerEvent) => { if (menu && !menu.contains(e.target as Node)) closeMenu() }
  const keydown = (e: KeyboardEvent) => { if (e.key === 'Escape') { closeMenu(true); cancelDrag() } }
  /** Escape, a lost pointer or the window losing focus: the cell goes back, nothing is sent. */
  function cancelDrag() {
    if (!drag) return
    drag.cell.g.classList.remove('drag'); drag = null; hideTip(); setTarget(null)
  }
  const blur = () => cancelDrag()
  function undoMerge(sourceId: string, near: Cell) {
    hideUndo()
    void actions.unmerge(sourceId).then(ok => { if (!ok) tipAt(near, text('actionFailed')) })
  }
  /** Right after a merge: a small "undo" under the merged cell for a few seconds; the cell's menu keeps the undo after it fades. */
  function offerUndo(sourceId: string, near: Cell) {
    clearTimeout(undoTimer)
    undo.textContent = text('undo')
    const r = near.m.getBoundingClientRect()
    undo.style.left = (r.left + r.width / 2) + 'px'; undo.style.top = (r.bottom + 6) + 'px'
    undo.onclick = () => undoMerge(sourceId, near)
    undo.classList.add('on')
    undoTimer = window.setTimeout(hideUndo, 6000)
  }
  function hideUndo() { clearTimeout(undoTimer); undo.classList.remove('on'); undo.onclick = null }
  function tipAt(c: Cell, s: string) {
    placeTip(c.m.getBoundingClientRect(), s); window.setTimeout(hideTip, 1800)
  }

  function dropTarget(e: PointerEvent, c: Cell): typeof target {
    for (const el of document.elementsFromPoint(e.clientX, e.clientY)) {
      if (c.g.contains(el)) continue
      const mark = options.mark()
      const card = mark?.closest('button')
      if (card?.contains(el)) return { kind: 'main' }
      // The same rule as a press: of the cells under the pointer, the nearest centre. In the collapsed rail the small cells only
      // watch; merging them by dragging one onto another is left to the open sidebar.
      const g = el.closest('.theone-cell'), o = g && (cellAt(e.clientX, e.clientY, c, true) ?? cells.find(x => x.g === g && x.mode === 'live' && x.kind === 'topic'))
      if (o && o !== c) { if (rail) continue; return { kind: 'cell', cell: o } }
      const row = el.closest('[data-row-key^="session:"]')
      if (row) return { kind: 'session', el: row, id: row.getAttribute('data-row-key')!.slice(8) }
    }
    return null
  }
  function setTarget(next: typeof target) {
    const was = target
    if (was?.kind === next?.kind && (was as { cell?: Cell })?.cell === (next as { cell?: Cell })?.cell && (was as { el?: Element })?.el === (next as { el?: Element })?.el) return
    if (was?.kind === 'cell') was.cell.g.classList.remove('fuse')
    if (was?.kind === 'session') was.el.removeAttribute('data-theone-drop')
    if (was?.kind === 'main') options.mark()?.closest('button')?.removeAttribute('data-theone-drop')
    if (next?.kind === 'cell') next.cell.g.classList.add('fuse')
    if (next?.kind === 'session') next.el.setAttribute('data-theone-drop', 'true')
    if (next?.kind === 'main') options.mark()?.closest('button')?.setAttribute('data-theone-drop', 'true')
    target = next
  }
  function dropText(c: Cell, hit: NonNullable<typeof target>): string {
    if (hit.kind === 'main') return c.cur ? '' : text('dropMain', { name: c.title })
    if (hit.kind === 'cell') return text(busy(c) || busy(hit.cell) ? 'dropMergeLater' : 'dropMerge', { name: hit.cell.title })
    return text('dropSession', { name: c.title })
  }
  const REST = 500
  /** Where a release would land right now; another cell counts only once the pointer has rested on it. */
  function aim(e: { clientX: number; clientY: number }, c: Cell) {
    const hit = dropTarget(e as PointerEvent, c)
    if (!drag) return hit
    if (hit?.kind !== 'cell') { drag.rest = undefined; return hit }
    if (drag.rest?.cell !== hit.cell) drag.rest = { cell: hit.cell, since: now() }
    return now() - drag.rest.since >= REST ? hit : null
  }
  /** The tip and highlight for where the drag is aiming: resting on a cell first says what holding will do. */
  function showAim(c: Cell) {
    if (!drag) return
    const hit = aim({ clientX: drag.last.x, clientY: drag.last.y }, c)
    setTarget(hit)
    const resting = !hit && drag.rest ? text('mergeHold', { name: drag.rest.cell.title }) : ''
    placeTip(pointerBox(drag.last.x, drag.last.y), hit ? dropText(c, hit) : resting)
  }
  const move = (e: PointerEvent) => {
    const p = local(e), r = host.getBoundingClientRect()
    ptr = e.clientX > r.left - 24 && e.clientX < r.right + 24 && e.clientY > r.top - 10 && e.clientY < r.bottom + 24 ? p : null
    if (!drag) return
    const c = drag.cell
    drag.last = { x: e.clientX, y: e.clientY }
    drag.trail.push({ x: e.clientX, y: e.clientY, t: now() }); if (drag.trail.length > 8) drag.trail.shift()
    // A press becomes a drag only after a real move, so a click or a shaky press never drags.
    if (!drag.started) {
      if (Math.hypot(e.clientX - drag.trail[0].x, e.clientY - drag.trail[0].y) < 5) return
      drag.started = true; c.g.classList.add('drag')
    }
    c.tx = p.x - drag.dx; c.ty = p.y - drag.dy
    showAim(c)
  }
  const up = (e: PointerEvent) => {
    if (!drag) return
    const c = drag.cell, trail = drag.trail, started = drag.started
    drag.last = { x: e.clientX, y: e.clientY }
    // Checked again where the pointer was let go, not where it last moved.
    const hit = started ? aim(e, c) : null
    c.g.classList.remove('drag'); drag = null; hideTip(); setTarget(null)
    if (!started) {
      // A click on a candidate routing hesitated over moves the message there; a failed try keeps the candidate.
      if (!c.offer || c.g.classList.contains('pending')) return
      const { messageId } = c.offer
      c.g.classList.add('pending')
      void actions.reroute(messageId, c.id).then(status => {
        c.g.classList.remove('pending')
        if (status >= 200 && status < 300) { for (const o of cells) if (o.offer?.messageId === messageId) clearOffer(o); light(c); return }
        if (c.offer) c.offer.until = Math.max(c.offer.until, now() + 30000)
        tipAt(c, text(status === 409 ? 'rerouteBusy' : 'rerouteFailed'))
      })
      return
    }
    if (hit?.kind === 'main') { if (!c.cur) actions.mount(c.id); return }
    if (hit?.kind === 'cell') {
      // The two are joined by a neck until TheOne confirms; only then they fuse, otherwise the neck lets go.
      const into = hit.cell
      bonds = [...bonds.filter(b => b[0] !== c && b[1] !== c), [c, into]]
      void actions.merge(c.id, into.id).then(result => {
        if (result === 'merged') { apply({ kind: 'merged', id: c.id, into: into.id }); offerUndo(c.id, into) }
        else if (result === 'failed') { bonds = bonds.filter(b => b[0] !== c); tipAt(into, text('mergeFailed')) }
      })
      return
    }
    if (hit?.kind === 'session') {
      const icon = hit.el.querySelector('svg, img, i') ?? hit.el
      const box = () => { const a = icon.getBoundingClientRect(), b = host.getBoundingClientRect(); return { x: a.left + a.width / 2 - b.left, y: a.top + a.height / 2 - b.top } }
      // The chat flies in only once TheOne has attached it.
      void actions.attach(c.id, hit.id).then(ok => { if (ok) vesicle(box, () => pos(c), () => light(c)); else tipAt(c, text('actionFailed')) })
      return
    }
    // No throwing small cells in the collapsed rail: they are for watching and clicking, so a quick stray drag sets nothing aside.
    if (rail) return
    // A throw needs speed: a slow drag past the sidebar's edge is not a throw.
    const firstS = trail.find(s => now() - s.t < 90) ?? trail[0], lastS = trail[trail.length - 1]
    if (!firstS || !lastS) return
    const dt = Math.max(16, lastS.t - firstS.t) / 1000, vx = (lastS.x - firstS.x) / dt, vy = (lastS.y - firstS.y) / dt
    const sr = options.side()?.getBoundingClientRect()
    const out = !!sr && (e.clientX > sr.right + 6 || e.clientX < sr.left - 6)
    const speed = Math.hypot(vx, vy)
    if (speed <= 1100 && !(out && speed > 500)) return
    if (busy(c) || c.cur) {
      c.vx = -vx * .15; c.vy = -vy * .15; c.kick = 1
      placeTip(pointerBox(e.clientX, e.clientY), text(c.cur ? 'currentFling' : 'busyFling'))
      window.setTimeout(hideTip, 1300)
      return
    }
    const k = Math.min(1, 2600 / speed)
    c.mode = 'fling'; c.age = 0; c.vx = vx * k; c.vy = vy * k; c.g.style.pointerEvents = 'none'
    bonds = bonds.filter(b => b[0] !== c && b[1] !== c)
    void actions.putAside(c.id).then(ok => {
      if (ok || c.mode !== 'fling') return
      // TheOne said no: the topic buds back out of the mark.
      c.mode = 'bud'; c.age = 0; c.x = L.x; c.y = L.y; c.vx = 0; c.vy = 0; c.scale = .12; c.alpha = 1; c.hidden = false; c.g.style.pointerEvents = ''
      pulse = Math.max(pulse, .6)
      c.onBorn = () => tipAt(c, text('actionFailed'))
    })
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', blur)
  window.addEventListener('blur', blur)
  document.addEventListener('pointerdown', outside, true)
  document.addEventListener('keydown', keydown, true)

  function step(dt: number) {
    const T = now()
    options.place?.()
    if (drag?.started && drag.rest && target?.kind !== 'cell') showAim(drag.cell)
    sz = ease(sz, rail ? MINI : 1, 4, dt)
    const words = clamp((sz - .72) / .28)

    // Which topics show: past the limit the least used fold into "+N", set-aside topics always fold, the collapsed rail shows only active ones.
    const all = topics().filter(c => c.mode !== 'fling')
    const prio = (c: Cell) => (c.cur || c.state !== 'idle' || c.ask || c.mode === 'bud' ? 10 : 0) + c.w
    const order = all.filter(c => !c.aside || busy(c) || c.rebud).sort((a, b) => prio(b) - prio(a))
    const keep = new Set(order.length > MAX_VISIBLE ? order.slice(0, MAX_VISIBLE - 1) : order)
    folded = all.filter(c => !keep.has(c)).length
    for (const c of all) {
      const isFolded = !keep.has(c), hide = c.mode === 'live' && (isFolded || (rail && !c.cur && c.state === 'idle'))
      if (c.hidden && !hide && c.mode === 'live' && c.away && c.rebud) { c.mode = 'bud'; c.age = 0; c.x = L.x; c.y = L.y; c.scale = .12; pulse = Math.max(pulse, .7) }
      if (c.mode === 'live') { c.hidden = hide; c.away = hide && isFolded }
      if (!hide) c.rebud = false
    }
    more.hidden = !folded || rail
    const moreName = '+' + folded
    if (more.title !== moreName) { more.title = moreName; more.kick = .8 }

    for (const b of [...bonds]) if (b.some(c => c.mode !== 'live')) bonds.splice(bonds.indexOf(b), 1)
    for (const c of all) if (c.offer) {
      if (T > c.offer.until) clearOffer(c)
      else if (T > c.offer.until - 56000 && !c.g.classList.contains('offer')) { c.g.classList.add('offer'); if (!c.ask) c.g.classList.remove('ask') }
    }

    const live = cells.filter(c => c.mode === 'live' && !c.hidden)
    let top = Infinity, bottom = -Infinity, x0 = Infinity, x1 = -Infinity
    for (const c of live) if (drag?.cell !== c) { top = Math.min(top, c.y - c.R); bottom = Math.max(bottom, c.y + c.R); x0 = Math.min(x0, c.x - c.R); x1 = Math.max(x1, c.x + c.R) }
    const want = bottom > top ? Math.min(320, bottom - top + 14 * sz + 4) : 4
    // The box follows the cluster on a soft spring with a little give; small wobbles of the cells do not move the sidebar.
    if (heightTarget < 0) { height = heightTarget = want; host.style.height = fx(height) + 'px'; options.onHeight(height) }
    if (want > heightTarget + 2 || want < heightTarget - 6) heightTarget = want
    const hk = 70, hc = 2 * .72 * Math.sqrt(hk)
    heightV += (hk * (heightTarget - height) - hc * heightV) * dt
    if (reduced() || (Math.abs(heightTarget - height) < .05 && Math.abs(heightV) < .05)) heightV = 0
    const nextHeight = reduced() ? heightTarget : heightV ? height + heightV * dt : heightTarget
    if (Math.abs(nextHeight - height) > .01) { height = nextHeight; host.style.height = fx(height) + 'px'; options.onHeight(height) }
    const fr = host.getBoundingClientRect(), mark = options.mark(), mr = mark?.getBoundingClientRect()
    const w = fr.width, h = Math.max(height, 8), cx = w / 2, cy = Math.max(14, h / 2)
    if (mr) L = { x: mr.left + mr.width / 2 - fr.left, y: mr.top + mr.height / 2 - fr.top }
    const markR = MARK_R + pulse * pulse * .8
    const shiftX = x1 > x0 ? (cx - (x0 + x1) / 2) * 3 : 0, shiftY = bottom > top ? (cy - (top + bottom) / 2) * 2 : 0

    // Forces: an oval pull to the middle, recent topics rise toward the card, related topics stick together, pressure where cells touch, slow wander.
    for (const c of cells) {
      let fx2 = 0, fy2 = 0, damp = .06
      c.age += dt
      if (c.mode === 'bud') {
        const dx = cx - L.x, dy = cy - L.y, d = Math.hypot(dx, dy) || 1
        const reach = markR + sizeOf(c) * sz * c.scale * .95 + c.age * 9 * sz
        fx2 = (L.x + dx / d * reach - c.x) * 90; fy2 = (L.y + dy / d * reach - c.y) * 90; damp = .002
        if (c.age > .8) { c.mode = 'live'; c.hidden = false; c.away = false; c.vx += dx / d * 120; c.vy += dy / d * 120; c.onBorn?.(); c.onBorn = undefined }
      } else if (c.mode === 'leave') {
        if (c.into && cells.includes(c.into)) { fx2 = (c.into.cx - c.x) * 40; fy2 = (c.into.cy - c.y) * 40; damp = .003 }
      } else if (c.mode === 'fling') {
        damp = .35
      } else if (c.hidden) {
        fx2 = (cx - c.x) * 4; fy2 = (cy - c.y) * 4
      } else {
        const act = c.cur || c.state !== 'idle' ? 1 : c.w
        const ox = cx - c.x, oy = (cy - c.y) * 1.8, od = Math.hypot(ox, oy) || 1, pull = Math.min(od, 30 * sz) * 1.6
        // The topic main chat is in rises closest to the card it belongs to.
        fx2 += ox / od * pull + shiftX; fy2 += oy / od * pull + shiftY - (28 * (act - .45) + (c.cur ? 45 : 0)) * sz
        const wob = (c.state === 'running' ? 14 : c.state === 'idle' ? 3 + 4 * c.w : 5) * sz
        fx2 += wob * Math.sin(t * .31 + c.phase) + wob * .5 * Math.sin(t * .83 + c.phase * 2)
        fy2 += wob * Math.cos(t * .27 + c.phase * 1.4)
        for (const o of live) {
          if (o === c) continue
          const dx = o.x - c.x, dy = o.y - c.y, d = Math.hypot(dx, dy) || .01, rest = (c.R + o.R) * .93, lw = linkW(c, o)
          const f = d < rest ? -(rest - d) * 40 : d < rest * 1.5 ? (d - rest) * Math.max(4, 11 + 12 * lw) : lw > 0 && d < rest * 3.2 ? (d - rest) * 6 * lw : 0
          fx2 += dx / d * f; fy2 += dy / d * f
        }
        if (ptr && !drag) {
          const dx = ptr.x - c.x, dy = ptr.y - c.y, d = Math.hypot(dx, dy) || 1, reach = 80 * sz
          if (d < reach) { const f = (c.state === 'running' ? 16 : 6) * (1 - d / reach); fx2 += dx / d * f; fy2 += dy / d * f }
        }
        if (drag?.cell !== c) {
          const pad = c.R * .8
          if (c.x < pad) fx2 += (pad - c.x) * 30
          if (c.x > w - pad) fx2 -= (c.x - (w - pad)) * 30
          if (c.y < pad * .7) fy2 += (pad * .7 - c.y) * 30
          if (c.y > h - pad * .7) fy2 -= (c.y - (h - pad * .7)) * 30
        }
      }
      if (drag?.cell === c) { fx2 += (c.tx - c.x) * 70; fy2 += (c.ty - c.y) * 70 }
      // While a cell is being dragged the others hold their places, so the one under the pointer stays there to be dropped on.
      else if (drag?.started && c.mode === 'live' && !c.hidden) { c.vx = c.vy = 0; continue }
      c.vx = (c.vx + fx2 * dt) * Math.pow(damp, dt); c.vy = (c.vy + fy2 * dt) * Math.pow(damp, dt)
      c.x += c.vx * dt; c.y += c.vy * dt
    }
    for (const [c, o] of bonds) {
      const dx = o.x - c.x, dy = o.y - c.y, d = Math.hypot(dx, dy) || 1, f = (d - (c.R + o.R) * .9) * 10 * dt
      c.vx += dx / d * f; c.vy += dy / d * f; o.vx -= dx / d * f; o.vy -= dy / d * f
    }

    for (const c of [...cells]) {
      if (c.mode === 'leave') {
        const o = c.into, alive = !!o && cells.includes(o)
        if (alive) {
          const d = Math.hypot(c.x - o!.cx, c.y - o!.cy)
          c.scale = ease(c.scale, clamp((d - o!.R * .3) / 50, .08, 1), 6, dt)
          if (d < o!.R * .45 || c.age > 3) c.alpha = ease(c.alpha, 0, 14, dt)
        } else { c.scale = ease(c.scale, 0, 5, dt); c.alpha = ease(c.alpha, 0, 4, dt) }
        if (c.alpha < .04 || c.scale < .03) {
          c.g.remove(); c.neck.remove(); c.gr.remove(); cells.splice(cells.indexOf(c), 1)
          if (alive) { o!.kick = 1; o!.flash = .7 }
          continue
        }
      } else if (c.mode === 'fling') {
        // Past the sidebar it fades; then it waits in the fold.
        const sr = options.side()?.getBoundingClientRect(), gx0 = fr.left + c.x, gy0 = fr.top + c.y
        const outBy = sr ? Math.max(gx0 - sr.right, sr.left - gx0, gy0 - sr.bottom, sr.top - gy0, 0) : 0
        c.alpha = clamp(1 - outBy / 90)
        if (c.alpha < .03 || c.age > 1.4) { c.mode = 'live'; c.aside = true; c.hidden = true; c.away = true; c.alpha = 1; c.scale = 0; c.vx = c.vy = 0; c.x = cx; c.y = cy; c.g.style.pointerEvents = ''; more.kick = 1; continue }
      } else if (c.mode === 'bud') c.scale = ease(c.scale, .2 + c.age * .45, 5, dt)
      else c.scale = ease(c.scale, c.hidden ? 0 : 1, c.hidden ? 5 : 2.5, dt)
      c.g.style.display = c.scale < .02 ? 'none' : ''
      if (c.scale < .02) { c.nf.setAttribute('d', ''); c.ne.setAttribute('d', ''); continue }
      c.heat = ease(c.heat, c.state === 'running' ? 1 : 0, 1.3, dt)
      c.solid = ease(c.solid, c.state === 'queued' ? 0 : 1, 2.2, dt)
      c.kick = Math.max(0, c.kick - dt / .9)
      c.flash = Math.max(0, c.flash - dt / 1.4)
      if (c.ask) c.flash = Math.max(c.flash, .25 + .15 * Math.sin(t * 3))

      const running = c.state === 'running', tt = running ? t : 0
      // Reading with the pointer: cells near it swell a little, like a magnifier, and their names surface.
      let near = 0
      if (c.mode === 'live' && c.kind === 'topic' && sz > .7) {
        if (drag) near = drag.cell === c || (target?.kind === 'cell' && target.cell === c) ? 1 : 0
        else if (ptr) { const d = Math.hypot(ptr.x - c.cx, ptr.y - c.cy) - c.R * .4; near = clamp(1 - d / 52); near = near * near * (3 - 2 * near) }
      }
      c.reveal = ease(c.reveal, near, near > c.reveal ? 9 : 4, dt)
      const r0 = sizeOf(c) * sz * (1 + (named(c) ? .04 : .2) * c.reveal)
      c.svx = ease(c.svx, c.vx, 8, dt); c.svy = ease(c.svy, c.vy, 8, dt)
      const speed = Math.hypot(c.svx, c.svy), st = Math.min(c.mode === 'fling' ? .2 : .12, speed / 1100), ux0 = c.svx / (speed || 1), uy0 = c.svy / (speed || 1)
      const sigh = 1 + .1 * Math.sin(Math.PI * (1 - c.kick)) * (c.kick > 0 ? 1 : 0)
      const pts: number[][] = []
      for (let i = 0; i < N; i++) {
        const th = i / N * Math.PI * 2, ux = Math.cos(th), uy = Math.sin(th), along = ux * ux0 + uy * uy0
        let r = (c.R + (running ? (.35 * Math.sin(2 * th + tt * .5 + c.phase) + .25 * Math.sin(3 * th - tt * .37 + c.phase)) * sz : 0)) * c.scale * sigh
        r *= 1 + st * (2 * along * along - 1)
        if (c.mode === 'live') for (const o of live) {
          if (o === c) continue
          const ox = o.x - c.x, oy = o.y - c.y, D = Math.hypot(ox, oy)
          if (D < .01 || D > c.R + o.R + 4) continue
          const dot = (ux * ox + uy * oy) / D
          if (dot <= .05) continue
          r = smin(r, (D / 2 + (c.R * c.R - o.R * o.R) / (2 * D) - GAP / 2) / dot, SOFT * sz)
        }
        // A cell dragged right over another gives a negative cut; never let the outline turn inside out.
        r = Math.max(r, c.R * c.scale * .35)
        pts.push([c.x + r * ux, c.y + r * uy])
      }
      // Keep each cell's volume: squeezed cells bulge on their free side. The dragged one keeps its size.
      if (c.mode === 'live' && !c.hidden && drag?.cell !== c) {
        const area = polygonArea(pts) / Math.max(.01, (c.scale * sigh) ** 2)
        c.R = Math.min(ease(c.R, r0 * Math.sqrt(Math.PI * r0 * r0 / Math.max(area, 1)), 2, dt), r0 * 1.2)
      } else c.R = ease(c.R, r0, 4, dt)
      let gx = 0, gy = 0
      for (const p of pts) { gx += p[0]; gy += p[1] }
      gx /= N; gy /= N; c.cx = gx; c.cy = gy
      c.vin = Infinity; c.vr = 0
      for (const p of pts) { const r = Math.hypot(p[0] - gx, p[1] - gy); c.vin = Math.min(c.vin, r); c.vr = Math.max(c.vr, r) }
      const d = curve(pts)
      c.b.setAttribute('d', d); c.h.setAttribute('d', d); c.m.setAttribute('d', d)
      c.b.style.fillOpacity = fx(c.solid); c.h.style.opacity = fx(Math.min(1, c.heat + c.flash))
      c.stop.setAttribute('stop-opacity', fx(.18 * (1 + 1.4 * c.flash)))
      if (c.solid < .985) c.m.setAttribute('stroke-dasharray', `2.5 ${fx(3.5 * (1 - c.solid))}`)
      else if (c.kind === 'topic' && !c.ask) c.m.removeAttribute('stroke-dasharray')
      if (c.heat + c.flash > .01) { c.gr.setAttribute('cx', fx(50 + 16 * Math.sin(t * .23 + c.phase)) + '%'); c.gr.setAttribute('cy', fx(46 + 13 * Math.sin(t * .19 + c.phase * 1.3)) + '%') }
      c.g.style.opacity = fx(c.alpha)

      // Nucleus and name as one centred block: nucleus on top, the name below on one or two lines.
      const rr = (c.mode === 'live' ? r0 : c.R) * c.scale
      let lay = c.kind === 'more' ? { lines: [c.title], font: 10, lh: 12 } : foamLabel(c.title, rr)
      // A title too long for the cell gives way to its short name; the full title stays in the hint and the keyboard list.
      if (!lay.lines.length && c.kind === 'topic') lay = foamLabel(foamShortName(c.title, c.short), rr)
      const key = lay.lines.join('\n') + '|' + lay.font
      if (key !== c.shownKey) {
        c.shownKey = key; c.lay = lay
        c.label.textContent = ''
        for (const line of lay.lines) { const span = document.createElementNS(NS, 'tspan'); span.setAttribute('x', '0'); span.textContent = line; c.label.appendChild(span) }
        c.label.setAttribute('font-size', String(lay.font))
      }
      c.want = ease(c.want, named(c) ? 1 : 0, 2.5, dt)
      const vis = words * clamp((c.scale - .6) / .4) * (lay.lines.length ? 1 : 0) * Math.max(c.want, c.reveal)
      c.full = c.kind === 'more' || (vis > .5 && lay.lines.join('') === c.title)
      c.label.style.opacity = fx(vis)
      c.nx = ease(c.nx, running ? 1.4 * Math.sin(tt * .53 + c.phase) + .5 * Math.sin(tt * 1.1 + c.phase * 2) : 0, 3, dt)
      c.ny = ease(c.ny, running ? Math.sin(tt * .41 + c.phase * 1.7) : 0, 3, dt)
      const nr = c.kind === 'more' ? 0 : c.state === 'wait' ? 3.4 : c.state === 'done' ? 3.2 : c.cur ? 2.9 : running ? 2.6 + .15 * Math.sin(tt * .6 + c.phase) : c.state === 'queued' ? 2.4 : 1.8 + c.w * .8
      const lines = c.lay.lines.length, block = c.kind === 'more' ? 0 : lines ? 2 * nr + 4 + lines * c.lay.lh : 0, room = clamp(vis * 1.4)
      const top0 = gy - block / 2 * c.scale
      c.n.setAttribute('cx', fx(gx + c.nx * sz)); c.n.setAttribute('cy', fx(gy + ((lines ? top0 + nr * c.scale : gy) - gy) * room + c.ny * sz))
      c.n.setAttribute('r', fx(nr * c.scale * Math.max(.62, sz)))
      const ty = c.kind === 'more' ? gy : top0 + (2 * nr + 4 + c.lay.lh / 2) * c.scale
      c.label.setAttribute('transform', `translate(${fx(gx)} ${fx(ty)}) scale(${fx(Math.max(.01, c.scale))})`)
      Array.from(c.label.children).forEach((s, i) => s.setAttribute('y', fx(i * c.lay.lh)))

      // Necks: budding off the mark, fusing into another topic, a pending merge, or the preview while dragging onto a topic.
      let neck: ReturnType<typeof bridge> = null, other: Cell | undefined
      if (c.mode === 'bud') neck = bridge(L, markR, { x: gx, y: gy }, rr)
      else if (c.mode !== 'fling') {
        other = c.mode === 'leave' ? c.into : bonds.find(b => b[0] === c)?.[1] ?? (drag?.cell === c && target?.kind === 'cell' ? target.cell : undefined)
        if (other && cells.includes(other)) neck = bridge(pos(other), other.R * other.scale, { x: gx, y: gy }, rr, c.mode === 'leave' ? rr * 1.6 : rr + 6 * sz)
      }
      c.nf.setAttribute('d', neck ? neck.fill : ''); c.ne.setAttribute('d', neck ? neck.edge : '')
      if (neck) c.nf.style.fill = other?.state === 'done' ? 'var(--foam-done)' : other && other.state === 'idle' && !other.cur ? 'var(--foam-bg)' : 'var(--foam-tint)'
      c.neck.style.opacity = fx(c.alpha)
    }

    // Hit areas: small cells get a steady 24px circle to press where there is room, split fairly between neighbours and kept
    // inside the box. The cell being dragged is left out, so the ones it may land on keep theirs while it passes over them.
    const pressable = cells.filter(c => c.mode === 'live' && !c.hidden && c.scale >= .02 && !(drag?.started && drag.cell === c))
    const radii = foamHitRadii(pressable.map(c => ({ x: c.cx, y: c.cy, r: c.R * c.scale, floor: c.vin })), { w, h })
    for (const c of cells) {
      const i = pressable.indexOf(c), r = i < 0 ? 0 : radii[i]
      if (r || c.hit) { c.hit = r; c.hc.setAttribute('cx', fx(c.cx)); c.hc.setAttribute('cy', fx(c.cy)); c.hc.setAttribute('r', fx(r)) }
    }
    // A menu whose topic went away (merged, removed) closes rather than act on a cell that is no longer there.
    if (menuOf && menuOf.cell.kind === 'topic' && (menuOf.cell.mode === 'leave' || !cells.includes(menuOf.cell))) closeMenu('gone')

    // Vesicles: each message buds off one body, arcs over, and fuses into the other.
    for (const v of [...ves]) {
      v.t += dt / v.dur
      const p0 = v.from(), p2 = v.to(), k = v.t >= 1 ? 1 : v.t < .5 ? 2 * v.t * v.t : 1 - (-2 * v.t + 2) ** 2 / 2
      const mx = (p0.x + p2.x) / 2, my = (p0.y + p2.y) / 2, dx = p2.x - p0.x, dy = p2.y - p0.y
      const c1 = { x: mx - dy * .22, y: my + dx * .22 }
      let x = (1 - k) ** 2 * p0.x + 2 * (1 - k) * k * c1.x + k * k * p2.x, y = (1 - k) ** 2 * p0.y + 2 * (1 - k) * k * c1.y + k * k * p2.y
      const holding = typeof v.hold === 'function' ? !v.hold() : v.t < 1 + v.hold / v.dur
      if (v.t >= 1 && v.hold && holding) { x += 2.2 * Math.sin(t * 2.1); y += 1.6 * Math.sin(t * 2.9) }
      const grow = v.hold ? clamp(k / .15) : clamp(k / .15) * clamp((1 - k) / .2 + .25)
      v.el.setAttribute('transform', `translate(${fx(x)} ${fx(y)}) scale(${fx(grow * Math.max(.7, sz) * (v.el.hasAttribute('data-small') ? .7 : 1))})`)
      if (v.t >= 1 && !(v.hold && holding)) { v.el.remove(); ves.splice(ves.indexOf(v), 1); v.arrive() }
    }

    pulse = Math.max(0, pulse - dt * 1.4)
    options.onPulse?.(pulse * pulse)
    void T
  }

  // When frames come slowly (a busy machine, a throttled window), catch up in a few small steps so motion keeps its real pace.
  const frame = (n: number) => {
    let left = Math.min(4 / 30, Math.max(0, (n - last) / 1000)); last = n
    do {
      const dt = Math.min(1 / 30, left); left -= dt
      if (!reduced()) t += dt
      step(dt)
    } while (left > 1e-3)
    raf = requestAnimationFrame(frame)
  }
  raf = requestAnimationFrame(frame)

  return {
    update, event,
    setRail(on) { rail = on },
    destroy() {
      cancelAnimationFrame(raf); clearInterval(tipTimer)
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', blur); window.removeEventListener('blur', blur)
      document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', keydown, true)
      closeMenu(); hideUndo(); undo.remove(); tip.remove(); svg.remove(); list.remove(); host.classList.remove('theone-foam')
    },
  }
}

/** Colours follow the main card: warm tint and accent in light, blue in dark; idle cells take the sidebar's own fill. */
export const foamCss = `
.theone-foam{position:fixed;left:0;top:0;width:0;height:8px;z-index:20;pointer-events:none;--foam-bg:var(--dsw-specific-sidebar-fill,#f7f7f5);--foam-tint:#fff5ec;--foam-accent:#a75b1e;--foam-heat:#ff7800;--foam-line:#c99267;--foam-done:#ffffff;--foam-idle-line:#d8d3ca;--foam-idle-dot:#cdb8a3;--foam-queue-line:#c4c1b8;--foam-queue-ink:#9a988f;--foam-fail:#b9785f;--foam-text:var(--dsw-alias-label-primary,#2b2b2b);--foam-muted:var(--dsw-alias-label-secondary,#8a8a86)}
[data-ds-dark-theme] .theone-foam{--foam-bg:var(--dsw-specific-sidebar-fill,#1f1f22);--foam-tint:#1d2a37;--foam-accent:#93c8f3;--foam-heat:#80caff;--foam-line:#5d87ab;--foam-done:#2b2b30;--foam-idle-line:#4a515a;--foam-idle-dot:#5a7086;--foam-queue-line:#4d555e;--foam-queue-ink:#7f8a94;--foam-fail:#c98a74}
.theone-foam>svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
.theone-foam-list{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.theone-cell{cursor:grab;pointer-events:auto}
.theone-cell.drag{cursor:grabbing}
.theone-cell [data-part=hit]{fill:transparent;stroke:none;pointer-events:all}
.theone-cell [data-part=body]{stroke:none;fill:var(--foam-bg);transition:fill .8s ease}
.theone-cell [data-part=membrane]{fill:none;stroke:var(--foam-idle-line);stroke-width:1.2;stroke-linejoin:round;stroke-linecap:round;transition:stroke .8s ease,stroke-width .4s ease}
.theone-cell [data-part=nucleus]{fill:var(--foam-idle-dot);transition:fill .6s ease,stroke .6s ease}
.theone-cell text{fill:var(--foam-muted);text-anchor:middle;dominant-baseline:middle;pointer-events:none;user-select:none;letter-spacing:.02em;transition:fill .6s ease}
.theone-cell.running [data-part=body],.theone-cell.queued [data-part=body]{fill:var(--foam-tint)}
.theone-cell.running [data-part=membrane]{stroke:var(--foam-line);stroke-width:1.3}
.theone-cell.running [data-part=nucleus],.theone-cell.done [data-part=nucleus]{fill:var(--foam-accent)}
.theone-cell.running text,.theone-cell.done text{fill:var(--foam-text)}
.theone-cell.done [data-part=body]{fill:var(--foam-done)}
.theone-cell.done [data-part=membrane]{stroke:var(--foam-line);stroke-width:1.3}
.theone-cell.queued [data-part=membrane]{stroke:var(--foam-queue-line)}
.theone-cell.queued [data-part=nucleus]{fill:transparent;stroke:var(--foam-queue-ink);stroke-width:1}
.theone-cell.queued text{fill:var(--foam-queue-ink)}
.theone-cell.wait [data-part=body]{fill:var(--foam-tint)}
.theone-cell.wait [data-part=membrane]{stroke:var(--foam-accent);stroke-width:1.4}
.theone-cell.wait [data-part=nucleus]{fill:transparent;stroke:var(--foam-accent);stroke-width:1.4}
.theone-cell.wait text{fill:var(--foam-text)}
.theone-cell.fail [data-part=membrane]{stroke:var(--foam-fail);stroke-dasharray:1.5 2.5}
.theone-cell.fail [data-part=nucleus]{fill:transparent;stroke:var(--foam-fail);stroke-width:1.2}
.theone-cell.fail text{fill:var(--foam-fail)}
.theone-cell.cur [data-part=body]{fill:var(--foam-tint)}
.theone-cell.cur [data-part=membrane]{stroke:var(--foam-accent);stroke-width:1.4}
.theone-cell.cur [data-part=nucleus]{fill:var(--foam-accent)}
.theone-cell.cur text{fill:var(--foam-accent)}
.theone-cell.lit [data-part=membrane]{stroke:var(--foam-accent);stroke-width:1.6;transition-duration:.15s}
.theone-cell.ask [data-part=membrane]{stroke:var(--foam-accent);stroke-dasharray:3 3}
.theone-cell.fuse [data-part=membrane]{stroke:var(--foam-accent);stroke-width:1.6}
.theone-cell.more{cursor:pointer}
.theone-cell.offer{cursor:pointer}
.theone-cell.offer [data-part=membrane]{stroke:var(--foam-line)}
.theone-cell.offer [data-part=nucleus]{fill:var(--foam-accent)}
.theone-cell.pending [data-part=membrane]{stroke:var(--foam-accent);stroke-dasharray:2 3;animation:theone-foam-march 1s linear infinite}
@keyframes theone-foam-march{to{stroke-dashoffset:-10}}
.theone-foam-undo{position:fixed;z-index:1000;transform:translate(-50%,3px);padding:3px 10px;border:.5px solid var(--dsw-alias-border-l2,#8885);border-radius:999px;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#2b2b2b);font:inherit;font-size:12px;line-height:1.5;cursor:pointer;opacity:0;pointer-events:none;transition:opacity .15s,transform .15s}
.theone-foam-undo.on{opacity:1;pointer-events:auto;transform:translate(-50%,0)}
.theone-cell.more [data-part=membrane]{stroke-dasharray:1.2 3}
.theone-neck [data-part=edge]{fill:none;stroke:var(--foam-line);stroke-width:1.3;stroke-linecap:round}
.theone-vesicle [data-part=membrane]{fill:var(--foam-tint);stroke:var(--foam-accent);stroke-width:1.1}
.theone-vesicle [data-part=nucleus]{fill:var(--foam-accent)}
html[data-theone-foam] button:has(.theone-workspace-entry){display:none}
[data-row-key][data-theone-drop=true]{background:color-mix(in srgb,#ff7800 10%,transparent);box-shadow:inset 0 0 0 1px color-mix(in srgb,#a75b1e 40%,transparent);border-radius:10px}
.theone-foam-tip{position:fixed;z-index:1000;padding:4px 8px;border-radius:7px;background:var(--dsw-alias-label-primary,#2e2d2a);color:var(--dsw-alias-bg-base,#f4f3ef);font-size:11.5px;line-height:1.5;max-width:min(240px,calc(100vw - 16px));box-sizing:border-box;white-space:normal;overflow-wrap:anywhere;pointer-events:none;opacity:0;transform:translateY(3px);transition:opacity .12s,transform .12s}
.theone-foam-tip[data-side=below]{transform:translateY(-3px)}
.theone-foam-tip.on{opacity:1;transform:none}
.theone-foam-menu{position:fixed;z-index:1000;box-sizing:border-box;min-width:168px;max-width:min(320px,calc(100vw - 16px));max-height:calc(100vh - 16px);overflow-y:auto;overscroll-behavior:contain;padding:4px;border:.5px solid var(--dsw-alias-border-l2,#8885);border-radius:var(--dsw-radius-lg,12px);background:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-2,#fff));backdrop-filter:blur(24px) saturate(1.4);box-shadow:var(--dsw-elevation-prominent,0 8px 30px #0003);color:var(--dsw-alias-label-primary)}
.theone-foam-menu button{display:flex;width:100%;min-height:34px;align-items:center;padding:7px 12px;line-height:1.4;white-space:normal;overflow-wrap:anywhere;border:0;border-radius:var(--dsw-radius-md,8px);background:none;color:inherit;font:inherit;font-size:13.5px;cursor:pointer;text-align:left}
.theone-foam-menu button:hover,.theone-foam-menu button:focus-visible{background:var(--dsw-alias-interactive-bg-hover,#0000000a);outline:none}
.theone-foam-menu hr{border:0;border-top:.5px solid var(--dsw-alias-border-l2,#8885);margin:4px 2px}
@media(prefers-reduced-motion:reduce){.theone-cell [data-part=membrane],.theone-cell [data-part=body]{transition:none}.theone-cell.pending [data-part=membrane]{animation:none}.theone-foam-undo,.theone-foam-tip{transition:none}}
`

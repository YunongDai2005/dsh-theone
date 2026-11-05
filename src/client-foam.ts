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
}

export type FoamEvent =
  /** A message settled on a topic; `alternates` were the other close candidates, they only flicker. */
  | { kind: 'route'; to: string; related?: string[]; alternates?: string[] }
  /** More input for a topic that is already answering (steering). */
  | { kind: 'supplement'; to: string }
  | { kind: 'create'; to: string }
  /** Routing is truly blocked and needs the user: the vesicle waits between the candidates. */
  | { kind: 'clarify'; candidates: string[] }
  | { kind: 'resolve'; to?: string }
  | { kind: 'correct'; from: string; to: string }
  | { kind: 'merged'; id: string; into: string }

export type FoamTextKey =
  | 'more' | 'running' | 'queued' | 'answered' | 'asking' | 'bond' | 'waiting' | 'failed' | 'menuAnswer'
  | 'dropMain' | 'dropMerge' | 'dropMergeLater' | 'dropSession' | 'busyFling' | 'currentFling'
  | 'menuContinue' | 'menuOpen' | 'menuAside' | 'menuDelete' | 'menuStop' | 'menuCancel' | 'menuShowNow' | 'menuWorkspace'

export interface FoamActions {
  mount(id: string): void
  merge(id: string, into: string, whenIdle: boolean): void
  attach(id: string, sessionId: string): void
  putAside(id: string): void
  open(id: string): void
  stop(id: string): void
  cancelQueued(id: string): void
  remove(id: string): void
  showAnswer(id: string): void
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

/** How a name sits in a cell: one line if it fits, else two balanced lines, else no text (never a clipped name). */
export function foamLabel(name: string, radius: number): { lines: string[]; font: number; lh: number } {
  const chars = [...name], big = radius >= 25 ? 10.5 : 9.5, small = radius >= 25 ? 9.5 : 8.8
  // A Latin letter takes about 0.6 of a CJK character's width.
  const width = (s: string[]) => s.reduce((w, ch) => w + (/[⺀-￿]/.test(ch) ? 1 : .6), 0)
  const tries: [number, number][] = [[1, big], [1, small], [2, big], [2, small]]
  for (const [lines, font] of tries) {
    if (lines === 1 && font === small && width(chars) > 3 && radius < 25) continue
    if (lines === 2 && (chars.length < 4 || width(chars) > 8)) continue
    const lh = font * 1.2, per = Math.ceil(chars.length / lines)
    const parts = lines === 1 ? [chars] : [chars.slice(0, per), chars.slice(per)]
    const widest = Math.max(...parts.map(width)) * font
    if (widest > 2 * radius * (lines === 1 ? .8 : .74) - 4 || 9 + lines * lh > 2 * radius * .82) continue
    return { lines: parts.map(p => p.join('')), font, lh }
  }
  return { lines: [], font: big, lh: 0 }
}

type CellState = 'idle' | 'running' | 'queued' | 'done' | 'wait' | 'fail'
interface Cell {
  id: string; kind: 'topic' | 'more'; title: string; state: CellState; cur: boolean; ask: boolean; aside: boolean; oneOff: boolean
  group?: string; w: number; startedAt?: number
  g: SVGGElement; gr: SVGRadialGradientElement; stop: SVGStopElement; b: SVGPathElement; h: SVGPathElement; m: SVGPathElement; n: SVGCircleElement; label: SVGTextElement
  neck: SVGGElement; nf: SVGPathElement; ne: SVGPathElement
  mode: 'bud' | 'live' | 'leave' | 'fling'; age: number; hidden: boolean; away: boolean; rebud: boolean; onBorn?: () => void; into?: Cell
  x: number; y: number; vx: number; vy: number; svx: number; svy: number; tx: number; ty: number; R: number; scale: number; alpha: number
  heat: number; solid: number; kick: number; flash: number; reveal: number; want: number; nx: number; ny: number; cx: number; cy: number
  phase: number; shownKey: string; full: boolean; lay: { lines: string[]; font: number; lh: number }; showing: boolean
}
interface Vesicle { el: SVGGElement; from: () => Pt; to: () => Pt; arrive: () => void; t: number; dur: number; hold: number | (() => boolean); toMark: boolean }

export function createFoam(options: FoamOptions): Foam {
  const { host, actions } = options
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
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
  let rail = false, sz = 1, height = 8, pulse = 0, folded = 0, uid = 0, first = true
  let L: Pt = { x: 0, y: 0 }, ptr: Pt | null = null
  let drag: { cell: Cell; dx: number; dy: number; trail: { x: number; y: number; t: number }[] } | null = null
  let target: { kind: 'main' } | { kind: 'cell'; cell: Cell } | { kind: 'session'; el: Element; id: string } | null = null
  let clarifying: { cells: Cell[]; ves?: Vesicle } | null = null
  let menu: HTMLDivElement | null = null, tipOwner: Cell | null = null, raf = 0, last = now(), t = 0
  const pending: FoamEvent[] = []

  const sizeOf = (c: Cell) => c.kind === 'more' ? 16 : c.oneOff ? 21 : c.state === 'running' || c.state === 'done' || c.state === 'wait' || c.state === 'fail' || c.cur ? 29 : c.state === 'queued' ? 24 : 16 + 9 * c.w
  /** At rest only the topics doing something carry a name; the rest are plain cells until the pointer comes near. */
  const named = (c: Cell) => c.kind === 'more' || c.cur || c.state !== 'idle' || c.ask || c.mode === 'bud'
  const busy = (c: Cell) => c.state === 'running' || c.state === 'queued' || c.state === 'wait' || c.state === 'done'
  const topics = () => cells.filter(c => c.kind === 'topic' && c.mode !== 'leave')
  const byId = (id: string) => cells.find(c => c.kind === 'topic' && c.id === id && c.mode !== 'leave')
  const linkW = (c: Cell, o: Cell) => (c.group && c.group === o.group ? .8 : 0) + (links.get(c.id + '|' + o.id) ?? 0)
  const local = (e: { clientX: number; clientY: number }) => { const r = host.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top } }
  const pos = (c: Cell): Pt => ({ x: c.cx, y: c.cy })
  const markPos = (): Pt => ({ x: L.x, y: L.y })

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
    const w = host.clientWidth
    const c: Cell = { id, kind: 'topic', title, state: 'idle', cur: false, ask: false, aside: false, oneOff: false, w: .05,
      g, gr, stop: gr.firstChild as SVGStopElement, b: g.children[0] as SVGPathElement, h: g.children[1] as SVGPathElement, m: g.children[2] as SVGPathElement,
      n: g.children[3] as SVGCircleElement, label: g.children[4] as SVGTextElement, neck, nf: neck.children[0] as SVGPathElement, ne: neck.children[1] as SVGPathElement,
      mode: spawn ? 'bud' : 'live', age: 0, hidden: false, away: false, rebud: false,
      x: spawn ? L.x : w / 2 + (Math.random() - .5) * 90, y: spawn ? L.y : 30 + Math.random() * 100, vx: 0, vy: 0, svx: 0, svy: 0, tx: 0, ty: 0,
      R: 20, scale: spawn ? .12 : 1, alpha: 1, heat: 0, solid: 1, kick: 0, flash: 0, reveal: 0, want: 0, nx: 0, ny: 0, cx: 0, cy: 0,
      phase: Math.random() * 6, shownKey: '', full: false, lay: { lines: [], font: 9.5, lh: 0 }, showing: false }
    let hover = 0
    g.addEventListener('pointerdown', e => {
      if (e.button || c.mode !== 'live' || c.kind === 'more') return
      e.preventDefault(); clearTimeout(hover); hideTip()
      const p = local(e)
      drag = { cell: c, dx: p.x - c.x, dy: p.y - c.y, trail: [{ x: e.clientX, y: e.clientY, t: now() }] }
      c.tx = c.x; c.ty = c.y; g.classList.add('drag')
    })
    g.addEventListener('click', () => { if (c.kind === 'more' && !drag) actions.openWorkspace() })
    // Hover only tells what the cell cannot show itself: a name that did not surface, or what a busy topic is doing.
    g.addEventListener('pointerenter', () => { if (drag) return; clearTimeout(hover); hover = window.setTimeout(() => { if (!drag) showTip(c) }, 420) })
    g.addEventListener('pointerleave', () => { clearTimeout(hover); if (tipOwner === c) hideTip() })
    g.addEventListener('contextmenu', e => { e.preventDefault(); clearTimeout(hover); hideTip(); openMenu(e.clientX, e.clientY, c) })
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
      // The other close candidates flicker once: routing was not sure, and the user can still move it.
      for (const o of (event.alternates ?? []).map(byId)) if (o && o !== c && !o.hidden) { o.flash = Math.max(o.flash, .3); o.g.classList.add('ask'); window.setTimeout(() => { if (!o.ask) o.g.classList.remove('ask') }, 1400) }
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
      if (a && b) fuse(a, b); else if (a) fade(a)
    }
    return true
  }
  function endClarify() {
    if (!clarifying) return
    for (const c of clarifying.cells) { c.ask = false; c.g.classList.remove('ask') }
    clarifying = null
  }

  function update(model: FoamModel) {
    const seen = new Set<string>()
    for (const topic of model.topics) {
      seen.add(topic.id)
      let c = byId(topic.id)
      if (!c) c = makeCell(topic.id, topic.title, !first)
      const was = c.state
      c.title = topic.title; c.w = clamp(topic.weight); c.group = topic.group; c.aside = !!topic.aside; c.oneOff = !!topic.oneOff; c.startedAt = topic.startedAt
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
          if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); const r = c.m.getBoundingClientRect(); openMenu(r.left + r.width / 2, r.bottom, c) }
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
    if (c.ask) return who + text('asking')
    if (c.state === 'wait') return who + text('waiting')
    if (c.state === 'fail') return who + text('failed')
    if (c.state === 'queued') return who + text('queued')
    if (c.state === 'done') return who + text('answered')
    if (c.state === 'running') return who + text('running', { s: Math.max(0, Math.round((Date.now() - (c.startedAt ?? Date.now())) / 1000)) })
    return c.full ? '' : c.title
  }
  function placeTip(x: number, y: number, s: string) {
    if (!s) { tip.classList.remove('on'); return }
    tip.textContent = s; tip.style.left = x + 'px'; tip.style.top = y + 'px'; tip.classList.add('on')
  }
  function showTip(c: Cell) {
    tipOwner = c
    const r = c.m.getBoundingClientRect()
    placeTip(r.left + r.width / 2, r.top - 28, tipText(c))
  }
  function hideTip() { tipOwner = null; tip.classList.remove('on') }
  const tipTimer = window.setInterval(() => { if (tipOwner) showTip(tipOwner) }, 500)

  function closeMenu() { menu?.remove(); menu = null }
  function openMenu(x: number, y: number, c: Cell) {
    closeMenu()
    const items: ([string, () => void] | null)[] = c.kind === 'more' ? [[text('menuWorkspace'), actions.openWorkspace]]
      : c.state === 'running' ? [[text('menuOpen'), () => actions.open(c.id)], null, [text('menuStop'), () => actions.stop(c.id)]]
      : c.state === 'queued' ? [[text('menuOpen'), () => actions.open(c.id)], [text('menuCancel'), () => actions.cancelQueued(c.id)]]
      : c.state === 'done' ? [[text('menuShowNow'), () => actions.showAnswer(c.id)], [text('menuOpen'), () => actions.open(c.id)]]
      : c.state === 'wait' ? [[text('menuAnswer'), () => actions.answer(c.id)], [text('menuOpen'), () => actions.open(c.id)]]
      : [[text('menuContinue'), () => actions.mount(c.id)], [text('menuOpen'), () => actions.open(c.id)], ...(c.cur ? [] : [[text('menuAside'), () => actions.putAside(c.id)] as [string, () => void]]),
        null, [text('menuDelete'), () => actions.remove(c.id)]]
    const el = menu = document.createElement('div')
    el.className = 'theone-foam-menu'; el.setAttribute('role', 'menu')
    for (const item of items) {
      if (!item) { el.appendChild(document.createElement('hr')); continue }
      const row = document.createElement('button')
      row.type = 'button'; row.setAttribute('role', 'menuitem'); row.textContent = item[0]
      row.onclick = () => { closeMenu(); item[1]() }
      el.appendChild(row)
    }
    document.body.appendChild(el)
    const b = el.getBoundingClientRect()
    el.style.left = Math.min(x, innerWidth - b.width - 8) + 'px'; el.style.top = Math.min(y, innerHeight - b.height - 8) + 'px'
    el.querySelector('button')?.focus()
  }
  const outside = (e: PointerEvent) => { if (menu && !menu.contains(e.target as Node)) closeMenu() }
  const keydown = (e: KeyboardEvent) => { if (e.key === 'Escape') closeMenu() }

  function dropTarget(e: PointerEvent, c: Cell): typeof target {
    for (const el of document.elementsFromPoint(e.clientX, e.clientY)) {
      if (c.g.contains(el)) continue
      const mark = options.mark()
      const card = mark?.closest('button')
      if (card?.contains(el)) return { kind: 'main' }
      const g = el.closest('.theone-cell'), o = g && cells.find(x => x.g === g && x.mode === 'live' && x.kind === 'topic')
      if (o && o !== c) return { kind: 'cell', cell: o }
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
  const move = (e: PointerEvent) => {
    const p = local(e), r = host.getBoundingClientRect()
    ptr = e.clientX > r.left - 24 && e.clientX < r.right + 24 && e.clientY > r.top - 10 && e.clientY < r.bottom + 24 ? p : null
    if (!drag) return
    const c = drag.cell
    c.tx = p.x - drag.dx; c.ty = p.y - drag.dy
    drag.trail.push({ x: e.clientX, y: e.clientY, t: now() }); if (drag.trail.length > 8) drag.trail.shift()
    const hit = dropTarget(e, c)
    setTarget(hit)
    placeTip(e.clientX, e.clientY - 32, hit ? dropText(c, hit) : '')
  }
  const up = (e: PointerEvent) => {
    if (!drag) return
    const c = drag.cell, hit = target, trail = drag.trail
    c.g.classList.remove('drag'); drag = null; hideTip(); setTarget(null)
    if (hit?.kind === 'main') { if (!c.cur) actions.mount(c.id); return }
    if (hit?.kind === 'cell') {
      // The two are joined by a neck until TheOne confirms; only then they fuse (a `merged` event), otherwise the neck lets go.
      bonds = [...bonds.filter(b => b[0] !== c && b[1] !== c), [c, hit.cell]]
      actions.merge(c.id, hit.cell.id, busy(c) || busy(hit.cell))
      return
    }
    if (hit?.kind === 'session') {
      const icon = hit.el.querySelector('svg, img, i') ?? hit.el
      const box = () => { const a = icon.getBoundingClientRect(), b = host.getBoundingClientRect(); return { x: a.left + a.width / 2 - b.left, y: a.top + a.height / 2 - b.top } }
      vesicle(box, () => pos(c), () => light(c))
      actions.attach(c.id, hit.id)
      return
    }
    // A throw: fast enough, or let go past the sidebar's edge.
    const firstS = trail.find(s => now() - s.t < 90) ?? trail[0], lastS = trail[trail.length - 1]
    if (!firstS || !lastS) return
    const dt = Math.max(16, lastS.t - firstS.t) / 1000, vx = (lastS.x - firstS.x) / dt, vy = (lastS.y - firstS.y) / dt
    const sr = options.side()?.getBoundingClientRect()
    const out = !!sr && (e.clientX > sr.right + 6 || e.clientX < sr.left - 6)
    if (Math.hypot(vx, vy) <= 1100 && !out) return
    if (busy(c) || c.cur) {
      c.vx = -vx * .15; c.vy = -vy * .15; c.kick = 1
      placeTip(e.clientX, e.clientY - 32, text(c.cur ? 'currentFling' : 'busyFling'))
      window.setTimeout(hideTip, 1300)
      return
    }
    const v = out && Math.hypot(vx, vy) < 400 ? { x: sr && e.clientX > sr.right ? 900 : -900, y: 0 } : { x: vx, y: vy }
    const k = Math.min(1, 2600 / Math.hypot(v.x, v.y))
    c.mode = 'fling'; c.age = 0; c.vx = v.x * k; c.vy = v.y * k; c.g.style.pointerEvents = 'none'
    bonds = bonds.filter(b => b[0] !== c && b[1] !== c)
    actions.putAside(c.id)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  document.addEventListener('pointerdown', outside, true)
  document.addEventListener('keydown', keydown, true)

  function step(dt: number) {
    const T = now()
    options.place?.()
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

    const live = cells.filter(c => c.mode === 'live' && !c.hidden)
    let top = Infinity, bottom = -Infinity, x0 = Infinity, x1 = -Infinity
    for (const c of live) if (drag?.cell !== c) { top = Math.min(top, c.y - c.R); bottom = Math.max(bottom, c.y + c.R); x0 = Math.min(x0, c.x - c.R); x1 = Math.max(x1, c.x + c.R) }
    const want = bottom > top ? Math.min(320, bottom - top + 14 * sz + 4) : 4
    const nextHeight = ease(height, want, 3, dt)
    if (Math.abs(nextHeight - height) > .2) { height = nextHeight; host.style.height = fx(height) + 'px'; options.onHeight(height) }
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
        fx2 += ox / od * pull + shiftX; fy2 += oy / od * pull + shiftY - 28 * (act - .45) * sz
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
      const lay = c.kind === 'more' ? { lines: [c.title], font: 10, lh: 12 } : foamLabel(c.title, rr)
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

  const frame = (n: number) => {
    const dt = Math.min(1 / 30, (n - last) / 1000); last = n
    if (!reduced) t += dt
    step(dt)
    raf = requestAnimationFrame(frame)
  }
  raf = requestAnimationFrame(frame)

  return {
    update, event,
    setRail(on) { rail = on },
    destroy() {
      cancelAnimationFrame(raf); clearInterval(tipTimer)
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up)
      document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', keydown, true)
      closeMenu(); tip.remove(); svg.remove(); list.remove(); host.classList.remove('theone-foam')
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
.theone-cell.more [data-part=membrane]{stroke-dasharray:1.2 3}
.theone-neck [data-part=edge]{fill:none;stroke:var(--foam-line);stroke-width:1.3;stroke-linecap:round}
.theone-vesicle [data-part=membrane]{fill:var(--foam-tint);stroke:var(--foam-accent);stroke-width:1.1}
.theone-vesicle [data-part=nucleus]{fill:var(--foam-accent)}
html[data-theone-foam] button:has(.theone-workspace-entry){display:none}
[data-row-key][data-theone-drop=true]{background:color-mix(in srgb,#ff7800 10%,transparent);box-shadow:inset 0 0 0 1px color-mix(in srgb,#a75b1e 40%,transparent);border-radius:10px}
.theone-foam-tip{position:fixed;z-index:1000;padding:4px 8px;border-radius:7px;background:var(--dsw-alias-label-primary,#2e2d2a);color:var(--dsw-alias-bg-base,#f4f3ef);font-size:11.5px;line-height:1.5;white-space:nowrap;pointer-events:none;opacity:0;transform:translate(-50%,3px);transition:opacity .12s,transform .12s}
.theone-foam-tip.on{opacity:1;transform:translate(-50%,0)}
.theone-foam-menu{position:fixed;z-index:1000;min-width:168px;padding:4px;border:.5px solid var(--dsw-alias-border-l2,#8885);border-radius:var(--dsw-radius-lg,12px);background:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-2,#fff));backdrop-filter:blur(24px) saturate(1.4);box-shadow:var(--dsw-elevation-prominent,0 8px 30px #0003);color:var(--dsw-alias-label-primary)}
.theone-foam-menu button{display:flex;width:100%;height:34px;align-items:center;padding:0 12px;border:0;border-radius:var(--dsw-radius-md,8px);background:none;color:inherit;font:inherit;font-size:13.5px;cursor:pointer;text-align:left}
.theone-foam-menu button:hover,.theone-foam-menu button:focus-visible{background:var(--dsw-alias-interactive-bg-hover,#0000000a);outline:none}
.theone-foam-menu hr{border:0;border-top:.5px solid var(--dsw-alias-border-l2,#8885);margin:4px 2px}
@media(prefers-reduced-motion:reduce){.theone-cell [data-part=membrane],.theone-cell [data-part=body]{transition:none}}
`

import { BEAT, D, b, r, E, clamp, lerp, rng, seg } from './timeline';

/* ---------------------------------------------------------- the DSH window (window px, y down) */
export const WIN = { w: 2000, h: 1100 };
/** window px → world (window centred on the origin, y up, 1 unit = 1 window px) */
export const W2 = (x: number, y: number, z = 0): [number, number, number] => [x - WIN.w / 2, WIN.h / 2 - y, z];
export const ONE = { x: 186, y: 208.5, w: 336, h: 91 };
export const ONE_W = W2(ONE.x, ONE.y);
export const LIST = { top: 452, h: 535 };

const POOL = ['Hello', 'Untitled', 'New session', 'Untitled', 'Q3 budget draft', 'Weekly report', 'Fix flaky CI test', 'SQL index help', 'Landing page copy',
  'Bug in CSV export', 'Interview questions', 'Release notes', 'Refactor auth flow', 'Habit tracker app', 'Cycling route, Sunday', 'Balcony herbs', 'Rust lifetimes',
  'Docker won’t start', 'Name ideas', 'Paper notes: RAG', 'Translate this email', 'Kyoto day plan', 'Recipe: tomato & egg', 'Cat on my keyboard', 'Is 77 BPM slow?',
  'Summarize this PDF', 'Meeting notes', 'Fix the chart colors', 'Rewrite intro', 'Pricing page ideas', 'Explain this regex', 'Trip budget', 'Email to landlord',
  'Slides outline', 'Untitled', 'New session', 'Continue from yesterday', 'That bug again', 'Where did we leave this?', 'Draft v2', 'Draft v3', 'Draft v3 (final)'];
const AGES = ['4m', '1h', '3h', '1d', '2d', '4d', '6d', '1w', '2w', '3w', '1mo', '2mo', '3mo', '5mo', '8mo', '1y'];
function genRows(n: number, seed: number, a0: number, a1: number): [string, string, boolean?][] {
  const r0 = rng(seed);
  return Array.from({ length: n }, (_, i) => {
    let tt = POOL[Math.floor(r0() * POOL.length)];
    if ((tt === 'Untitled' || tt === 'New session') && r0() < .5) tt += ` (${2 + Math.floor(r0() * 30)})`;
    return [tt, AGES[Math.min(AGES.length - 1, a0 + Math.floor((a1 - a0) * i / n))]];
  });
}
export const FOLDERS: [string, [string, string, boolean?][]][] = [
  ['Inbox', [['Download this video at max bitrate', '4m', true], ['Hello', '8d'], ['Can you control my computer?', '8d'], ['Hello', '10d'], ['archify-dsh plugin installed', '11d']]],
  ['Project A', genRows(30, 11, 1, 8)], ['Project B', genRows(30, 12, 3, 10)], ['Project C', genRows(28, 13, 5, 12)],
  ['Archive 2025', genRows(40, 14, 9, 15)], ['Unsorted', genRows(50, 15, 2, 15)], ['Old chats', genRows(40, 16, 12, 15)],
];
export interface Row { id: number; kind: 'folder' | 'session'; title: string; age?: string; dot?: boolean; top: number; h: number }
/** Rows laid out analytically (folder 47 px, session 45 px), so geometry never depends on DOM measurement. */
export const ROWS: Row[] = (() => {
  const out: Row[] = []; let y = 0;
  for (const [name, kids] of FOLDERS) {
    out.push({ id: out.length, kind: 'folder', title: name, top: y, h: 47 }); y += 47;
    for (const [tt, age, dot] of kids) { out.push({ id: out.length, kind: 'session', title: tt, age, dot, top: y, h: 45 }); y += 45; }
  }
  return out;
})();

/* ---------------------------------------------------------- the search: three escalating loops */
// trackpad swipes: [start, distance px, coast time] — inertial, so the speed is non-linear and the cursor stays still
export const SWIPES: [number, number, number][] = [
  [b(6), 560, BEAT], [b(7), 700, BEAT],
  [b(10), 760, .72 * BEAT], [b(10.75), 820, .72 * BEAT], [b(11.5), 520, .5 * BEAT],
  [b(14), 700, .5 * BEAT], [b(14.5), 760, .5 * BEAT], [b(15), 620, .5 * BEAT], [b(15.5), 700, .45 * BEAT],
  [b(18), 640, .5 * BEAT], [b(18.5), 700, .5 * BEAT], [b(19), 520, .25 * BEAT], [b(19.25), 560, .25 * BEAT], [b(19.5), 900, .5 * BEAT],
];
const coast = (u: number) => (1 - Math.exp(-5 * clamp(u))) / (1 - Math.exp(-5));
export const T_STOP = b(20), T_SLAM = b(21.5), T_UP0 = b(23.25), T_UP1 = b(24.25), CLICK_DSH = b(3.25), WIN_OPEN = b(4);
export function listScroll(t: number) { let s = 0; for (const [ts, d, T0] of SWIPES) if (t > ts) s += d * coast((t - ts) / T0); return s; }
export const REST: [number, number] = [262, 742];
export interface Scan { hov: number[]; dy: number; open: number; end: number }
export const SCANS: Scan[] = [
  { hov: [b(8.25), b(8.5), b(8.75)], dy: 45, open: b(9), end: b(10) },
  { hov: [b(12.25), b(12.5), b(12.75), b(13)], dy: -45, open: b(13.25), end: b(14) },
  { hov: [b(16.25), b(16.5)], dy: 45, open: b(16.75), end: b(17.5) },
];
/** session row whose box contains window y at scroll s */
export function rowAt(y: number, s: number): Row | null {
  for (const row of ROWS) { if (row.kind !== 'session') continue; const y1 = LIST.top + row.top - s; if (y >= y1 - 1 && y < y1 + row.h) return row; }
  return null;
}
const scanPts = SCANS.map(S => {
  const s1 = listScroll(S.hov[0]);
  const snap = (y0: number): [number, Row | null] => { const row = rowAt(y0, s1); return row ? [LIST.top + row.top - s1 + 23, row] : [y0, null]; };
  const pts: [number, number, Row | null][] = [...S.hov.map((h0, i) => [h0, ...snap(REST[1] + S.dy * (i + 1))] as [number, number, Row | null]),
    [S.open, ...snap(REST[1] + S.dy * (S.hov.length + 1))]];
  return { pts, opened: pts[pts.length - 1][2] };
});
/** cursor in window px during the search: [x, y, pressed] */
export function searchCursor(t: number): [number, number, boolean] {
  let x = REST[0], y = REST[1], press = false;
  SCANS.forEach((S, k) => {
    if (t < S.hov[0] - .2 || t > S.end + .05) return;
    let px = REST[0], py = REST[1];
    scanPts[k].pts.forEach(([tt, yy], i) => { const q = E.io(seg(t, tt - .14, tt - .02)); py = lerp(py, yy, q); px = lerp(px, REST[0] + (i % 2 ? -14 : 10), q); });
    const back = E.io(seg(t, S.end - .2, S.end + .05)); x = lerp(px, REST[0], back); y = lerp(py, REST[1], back);
    press = Math.abs(t - S.open) < .06;
  });
  return [x, y, press];
}
/** the session currently open in the main pane (the last one clicked) */
export function openedRow(t: number): Row | null { let row: Row | null = null; SCANS.forEach((S, k) => { if (t >= S.open) row = scanPts[k].opened; }); return row; }
export function hoveredRow(t: number): Row | null {
  if (t >= T_STOP || !SCANS.some(S => t > S.hov[0] - .2 && t < S.end)) return null;
  const [, y] = searchCursor(t); return rowAt(y, listScroll(t));
}

/* ---------------------------------------------------------- 3D layout (world units, y up) */
export const S_KEY = 1.5;                                    // the key grows as it lifts out
export const KEY_Z = 170;
export const KEY = [ONE_W[0], ONE_W[1], KEY_Z] as const;     // lifted key, straight out of the button
export const ROUTER = { p: [ONE_W[0] + 690, ONE_W[1] - 10, -40] as [number, number, number], w: 520, h: 300 };
const CC = [ONE_W[0] + 1400, ONE_W[1] - 10, -150];
export const CARD = { w: 230, h: 136 };
// eight sessions in a 3×3 grid; the ninth slot stays empty until CREATE fills it
export const CARD_T = ['Trip to Kyoto', 'Q3 budget', 'Habit tracker', 'Cycling route', 'Weekly report', 'Balcony herbs', 'Auth refactor', 'Paper notes'];
const cell = (i: number) => [CC[0] + ((i % 3) - 1) * 250, CC[1] - (Math.floor(i / 3) - 1) * 158, CC[2]] as [number, number, number];
export const CARDS = CARD_T.map((title, i) => ({ title, p: cell(i) }));
export const NEWC = { title: 'Cat feeder', p: cell(8) };
export const HIST = { p: [ONE_W[0] + 3350, ONE_W[1] - 30, -200] as [number, number, number], w: 1700, h: 620 };
export const CL = [
  { name: 'PROJECT A', t: r(13) }, { name: 'PROJECT B', t: r(14.25) }, { name: 'TRAVEL', t: r(15) }, { name: 'HOME', t: r(15.5) },
].map((c, i) => ({ ...c, p: [HIST.p[0] + (i - 1.5) * 400, HIST.p[1] - 30, HIST.p[2] + 4] as [number, number, number] }));
export const SLOT = { w: 370, h: 300 };
export const CHIP_T = ['Q3 budget draft', 'Weekly report', 'Refactor auth flow', 'Habit tracker app', 'Paper notes: RAG', 'Rust lifetimes',
  'Kyoto day plan', 'Kyoto day plan (2)', 'Trip budget', 'Balcony herbs', 'Recipe: tomato & egg', 'Cat on my keyboard'];
export const CHIP_CL = [0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3];

/* ---------------------------------------------------------- sound cues */
export interface Cue { t: number; type: string; g?: number; dur?: number; n?: string }
export const CUES: Cue[] = (() => {
  const C: Cue[] = []; const cue = (t: number, type: string, o: Partial<Cue> = {}) => C.push({ t: +t.toFixed(4), type, ...o });
  cue(CLICK_DSH, 'click');
  { let last = -1, lt = -1; for (let t = b(6); t < T_STOP; t += .002) { const k = Math.floor(listScroll(t) / 45); if (k !== last) { const v = (listScroll(t + .01) - listScroll(t)) * 100; if (last >= 0 && t - lt > .03) { cue(t, 'flapk', { g: clamp(.45 + v / 2600, .45, 1.05) }); lt = t; } last = k; } } }
  SCANS.forEach(S => { S.hov.forEach(x => cue(x, 'hov')); cue(S.open, 'click', { g: .7 }); });
  SWIPES.forEach(([ts], i) => cue(ts - .05, 'swipe', { g: i >= 9 ? 1.2 : i >= 5 ? 1 : .9 }));
  cue(T_STOP, 'growl', { dur: T_SLAM - T_STOP + .1 }); cue(T_SLAM, 'slam');
  { const r0 = rng(55); for (let j = 0; j < 18; j++) cue(T_SLAM + .3 + j * .045 + r0() * .06, 'book', { g: .5 + r0() * .5 }); }
  cue(T_UP0 - .05, 'whoosh', { dur: 1.1 }); cue(T_UP1, 'settle');
  cue(b(24.4), 'pad', { dur: D - b(24.4) }); cue(D - 1.6, 'swell', { dur: 1.6 });
  cue(D, 'click', { g: 1.1 }); cue(D, 'impact');
  cue(r(1), 'layer'); cue(r(2.25), 'layer', { g: .9 }); cue(r(3), 'layer', { g: .8 });
  cue(r(4), 'type'); cue(r(5), 'route', { n: 'G5' }); cue(r(6.25), 'hit', { n: 'C6' }); cue(r(7), 'route', { n: 'E5', g: .7 });
  cue(r(8), 'type'); cue(r(9), 'route', { n: 'A5' }); cue(r(10.25), 'create'); cue(r(11), 'route', { n: 'C6', g: .6 });
  cue(r(12), 'rise'); cue(r(13), 'snap'); cue(r(14.25), 'snap'); cue(r(15), 'snap'); cue(r(15.5), 'snap', { g: .8 });
  cue(r(17), 'deck'); cue(r(17.5), 'squeeze'); cue(r(18.25), 'rise'); cue(r(19), 'stack', { g: 1.2 }); cue(r(19), 'layer');
  cue(r(21), 'hit', { n: 'G5', g: .6 }); cue(r(24), 'swoosh2'); cue(r(27.4), 'swell', { dur: 1.6 }); cue(r(29), 'end');
  return C.sort((a, c) => a.t - c.t);
})();

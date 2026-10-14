/* Beat grid. Every frame is a pure function of t (seconds). */
export const FPS = 60;
export const BEAT = 60 / 77;                 // 77 BPM, 4/4
export const PRE = 28;                       // beats before the drop: the film opens on BGM bar -7
export const D = PRE * BEAT;                 // the drop, where The One is clicked
export const BGM_DROP = 93.2786;             // the drop's onset in the BGM (1:33.279)
export const BGM_START = +(BGM_DROP - D).toFixed(4);
export const b = (k: number) => k * BEAT;    // pre-drop beats
export const r = (k: number) => D + k * BEAT; // post-drop beats; each bar hits hardest on r(4k+1), then r(4k+2.25), r(4k+3)
export const TOTAL = +(r(36.75) + 0.3).toFixed(3);
export const FRAMES = Math.round(TOTAL * FPS);

export const clamp = (x: number, a = 0, c = 1) => (x < a ? a : x > c ? c : x);
export const lerp = (a: number, c: number, p: number) => a + (c - a) * p;
export const seg = (t: number, a: number, c: number) => clamp((t - a) / (c - a));
export const E = {
  l: (x: number) => x, i: (x: number) => x * x * x, o: (x: number) => 1 - Math.pow(1 - x, 3),
  io: (x: number) => (x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
  oe: (x: number) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x)), ie: (x: number) => (x <= 0 ? 0 : Math.pow(2, 10 * x - 10)),
  ioe: (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x < .5 ? Math.pow(2, 20 * x - 10) / 2 : (2 - Math.pow(2, -20 * x + 10)) / 2),
  ioq: (x: number) => (x < .5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2), oq: (x: number) => 1 - (1 - x) * (1 - x), iq: (x: number) => x * x,
  ob: (x: number) => { const c1 = 1.4, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); },
};
export type Ease = keyof typeof E;
type Key<V> = [number, V, Ease?];
/** Keyframed value (number or number[]) with per-segment easing. */
export function track<V extends number | number[]>(t: number, keys: Key<V>[]): V {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1, e] = keys[i];
    if (t <= t1) {
      const [t0, v0] = keys[i - 1];
      const f = E[e ?? 'io'](t1 === t0 ? 1 : (t - t0) / (t1 - t0));
      return (Array.isArray(v0) ? (v0 as number[]).map((a, j) => lerp(a, (v1 as number[])[j], f)) : lerp(v0 as number, v1 as number, f)) as V;
    }
  }
  return keys[keys.length - 1][1];
}
export function rng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
}
/** Light swell on each bar's strongest hit only, r(4k+1). */
export function pulse(t: number) { if (t < D) return 0; const x = ((t - D) / BEAT) % 4, d = x - 1; return d >= 0 ? Math.exp(-d * 3.2) : 0; }
export function lastHit(t: number) { const k = Math.floor(((t - D) / BEAT - 1) / 4); return D + (4 * k + 1) * BEAT; }
/** Arrival flash: rises just before t0, then decays to `hold`. */
export const land = (t: number, t0: number, hold = 0) => (t < t0 ? seg(t, t0 - .04, t0) : hold + (1 - hold) * Math.exp(-(t - t0) * 3.5));

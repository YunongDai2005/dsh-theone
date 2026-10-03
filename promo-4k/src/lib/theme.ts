export type Theme = 'light' | 'dark';
/** A warm accent by day; at night the same light mapped into the plugin's pale blue (#93c8f3). */
export function accent(theme: Theme, r: number, g: number, b: number): [number, number, number] {
  if (theme === 'light') return [r, g, b];
  const m = [b, g, r], t0 = [147, 200, 243];
  return m.map((v, i) => Math.round(v * .45 + t0[i] * .55)) as [number, number, number];
}
export const css = (c: [number, number, number], a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
/** Linear 0–1 colour (with optional HDR gain for bloom) from 0–255 sRGB. */
export const lin = (c: [number, number, number], gain = 1): [number, number, number] =>
  c.map(v => Math.pow(v / 255, 2.2) * gain) as [number, number, number];

export const PAL = {
  light: {
    bg0: '#ffffff', bg1: '#f4f6fa', bg2: '#e7ebf2', glass: '#ffffff', glassEdge: 'rgba(30,45,80,.10)', ink: '#16181c', sub: 'rgba(40,55,90,.45)',
    keyTop: '#fff5ec', keyEdge: '#f0c9a4', keyInk: '#a75b1e', keySub: '#61666b', bar: 'rgba(30,45,80,.08)', beam: '#7a8fc4', chip: '#ffffff', slot: '#ffffff',
  },
  dark: {
    bg0: '#1b1c20', bg1: '#111215', bg2: '#08080a', glass: '#202228', glassEdge: 'rgba(255,255,255,.08)', ink: '#eceef1', sub: 'rgba(200,212,240,.4)',
    keyTop: '#1d2a37', keyEdge: '#344d64', keyInk: '#93c8f3', keySub: '#adb2b8', bar: 'rgba(255,255,255,.08)', beam: '#7f95c8', chip: '#26272b', slot: '#202228',
  },
};

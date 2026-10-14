import { E, b, r, seg } from '../lib/timeline';
import { T_STOP, T_SLAM } from '../lib/story';
import type { Theme } from '../lib/theme';

/** A few big words on the beats, in the frame's empty space. */
const WORDS: { t0: number; t1: number; text: string; x: number; y: number; align: 'left' | 'right'; size: number }[] = [
  { t0: b(5.6), t1: b(7.85), text: '223 chats.', x: 1780, y: 640, align: 'right', size: 150 },
  { t0: b(9.05), t1: b(9.9), text: 'Not this one.', x: 1780, y: 660, align: 'right', size: 120 },
  { t0: b(13.3), t1: b(13.95), text: 'Nope.', x: 1780, y: 660, align: 'right', size: 150 },
  { t0: b(16.8), t1: b(17.45), text: 'Not here either.', x: 1780, y: 660, align: 'right', size: 112 },
  { t0: T_STOP, t1: T_SLAM + .7, text: 'Which one?', x: 1760, y: 620, align: 'right', size: 170 },
  { t0: r(1.25), t1: r(3.8), text: 'Just one.', x: 1780, y: 120, align: 'right', size: 150 },
  { t0: r(15.6), t1: r(16.95), text: 'Sorted.', x: 140, y: 880, align: 'left', size: 140 },
];

export function Words({ t, theme }: { t: number; theme: Theme }) {
  const dark = theme === 'dark';
  return <>{WORDS.map((w, i) => {
    if (t < w.t0 - .05 || t > w.t1 + .05) return null;
    const inK = E.o(seg(t, w.t0, w.t0 + .14)), out = 1 - seg(t, w.t1 - .14, w.t1);
    let dx = 0, dy = (1 - inK) * 46, rot = 0;
    if (w.text === 'Which one?') {
      const sh = E.io(seg(t, T_STOP, T_SLAM));            // trembles with the growl, then drops with the books
      dx += 6 * sh * Math.sin(t * 97); dy += 6 * sh * Math.sin(t * 83 + 1);
      const tau = Math.max(0, t - T_SLAM - .08); dy += .5 * 5200 * tau * tau; rot = 40 * tau * tau * 4;
    }
    return <div key={i} className="bigword" style={{ left: w.align === 'left' ? w.x : undefined, right: w.align === 'right' ? 1920 - w.x : undefined, top: w.y,
      fontSize: w.size, opacity: inK * out, transform: `translate(${dx}px,${dy}px) rotate(${rot}deg)`, transformOrigin: w.align === 'right' ? '100% 100%' : '0 100%',
      color: dark ? '#f2f4f7' : '#111318', textShadow: dark ? '0 0 50px rgba(0,0,0,.7)' : '0 0 50px rgba(255,255,255,.95),0 0 18px rgba(255,255,255,.9)' }}>{w.text}</div>;
  })}</>;
}

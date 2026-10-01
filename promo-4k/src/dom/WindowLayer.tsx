import * as THREE from 'three';
import { D, E, b, r, lerp, rng, seg, track } from '../lib/timeline';
import { ROWS, LIST, REST, T_STOP, T_SLAM, T_UP1, CLICK_DSH, WIN_OPEN, POOL, listScroll, searchCursor, openedRow, hoveredRow, type Row } from '../lib/story';
import { cssCamera, cssObject, makeCamera, type Shot } from '../lib/camera';
import { accent, css, type Theme } from '../lib/theme';
import { Ico, ARROW, HAND } from './icons';
import { toScreen, ICON } from './Desktop';

/** Window layout is rendered at WZ× and scaled back, so text stays sharp under the 3D camera. */
const WZ = 2;
type Msg = ['u' | 's' | 'a', string];
const OPENED: Msg[][] = [
  [['u', 'Where was that Kyoto link?'], ['s', 'Done in 4s'], ['a', 'Here are last week’s restaurant notes, grouped by area. The link you mean is not in this chat.'], ['u', 'Not this one.']],
  [['u', 'Pick up where we left off?'], ['s', 'Done in 6s'], ['a', 'We compared three options and leaned toward the second one. The details are below.'], ['u', 'Wrong project…']],
  [['u', 'What did we decide last time?'], ['s', 'Done in 3s'], ['a', 'I could not find that in this session. It may be in another chat.']],
];
const IDLE: Msg[] = [['u', 'Download https://www.bilibili.com/video/BV1mSffBFE4A at the highest bitrate'], ['s', 'Done in 3s'], ['a', 'Saved to Desktop as 320 kbps M4A.']];
const FALL = new Map<number, { sgn: number; jit: number; spin: number; dx: number }>();
{ const r0 = rng(31); [...ROWS.map(row => row.id), ...[0, 1, 2, 3].map(i => 1000 + i)].forEach(id => FALL.set(id, { sgn: r0() < .5 ? -1 : 1, jit: r0(), spin: .6 + r0() * .8, dx: r0() })); }
// a wall of every other conversation, far behind the window: it fills the margins and moves with parallax
const WALL = (() => { const r0 = rng(404); const out: { x: number; y: number; text: string }[] = [];
  for (let row = 0; row < 24; row++) for (let colN = 0; colN < 13; colN++) out.push({ x: colN * 430 + (row % 2) * 215 + (r0() - .5) * 60, y: row * 142 + (r0() - .5) * 30, text: POOL[Math.floor(r0() * POOL.length)] });
  return out; })();
const WALL_M = new THREE.Matrix4().makeTranslation(0, 0, -900);
const fallPlan = (() => { const s = listScroll(T_SLAM); return ROWS.map(row => [row, LIST.top + row.top - s] as [Row, number]).filter(([, y]) => y > 420 && y < 1000).sort((a, c) => c[1] - a[1]); })();
const fallIdx = new Map(fallPlan.map(([row], j) => [row.id, j]));
/** a book tipping off the shelf: a short tip, then gravity and spin */
function fallXf(id: number, j: number, t: number, t1: number) {
  const F = FALL.get(id)!, t0 = t1 + .04 + j * .045 + F.jit * .06, tau = Math.max(0, t - t0), tip = E.o(seg(t, t0, t0 + .1));
  const fy = tau > .1 ? .5 * 5200 * (tau - .1) ** 2 : 0, ang = F.sgn * (6 * tip + (tau > .1 ? (70 * (tau - .1) + 260 * (tau - .1) ** 2) * F.spin : 0));
  return { tip, origin: F.sgn > 0 ? '100% 100%' : '0 100%', transform: `translate(${F.sgn * F.dx * 120 * Math.max(0, tau - .1)}px,${fy}px) rotate(${ang}deg)` };
}

export function WindowLayer({ t, shot, theme }: { t: number; shot: Shot; theme: Theme }) {
  const dark = theme === 'dark';
  const cam = makeCamera(shot), cc = cssCamera(cam);
  // window-open from the dock icon (2D, before the 3D camera takes over)
  let open2d = 'none', openOp = 1, radius = 0;
  if (t < WIN_OPEN) {
    const p = E.oe(seg(t, CLICK_DSH + .02, WIN_OPEN)), [ix, iy] = toScreen(t, ICON.x, ICON.y), s = lerp(.05, 1, p);
    open2d = `translate(${lerp(ix, 960, p) - 960 * s}px,${lerp(iy, 540, p) - 540 * s}px) scale(${s})`; openOp = seg(t, CLICK_DSH, CLICK_DSH + .12); radius = lerp(200, 0, p);
  }
  const post = t >= D;
  const winOp = post ? lerp(1, .07, E.io(seg(t, D, r(1.4)))) * (1 - seg(t, r(11.6), r(12.4))) : 1;

  // ---- the search
  const sc = listScroll(Math.min(t, T_SLAM));
  const hov = hoveredRow(t), opened = openedRow(t);
  const scanIdx = opened ? [0, 1, 2].filter(k => t >= [b(9), b(13.25), b(16.75)][k]).length - 1 : -1;
  const msgs = scanIdx >= 0 ? OPENED[scanIdx] : IDLE, msgIn = scanIdx >= 0 ? seg(t, [b(9), b(13.25), b(16.75)][scanIdx] + .05, [b(9), b(13.25), b(16.75)][scanIdx] + .25) : 1;
  const falling = t >= T_SLAM;

  // ---- the reveal light
  const g = seg(t, T_UP1 - .3, b(25.3)), dimO = t < D ? .82 * E.io(g) : lerp(.82, 0, seg(t, D, r(1)));
  const gl = t > T_UP1 ? track(t, [[T_UP1, .2], [b(26.3), .65], [D, 1]]) + .06 * Math.sin(t * 3.4) : 0;
  const A = (r0: number, g0: number, b0: number) => accent(theme, r0, g0, b0);
  const oneGlow = gl ? `0 0 ${30 + 90 * gl}px ${4 + 26 * gl}px ${css(A(255, 140 + 40 * gl | 0, 60), .2 + .45 * gl)},0 0 ${10 + 20 * gl}px ${1 + 5 * gl}px ${css(A(255, 236, 210), .35 * gl)}` : undefined;

  // ---- cursor (inside the window, so it shares the camera)
  let cx = 0, cy = 0, hand = false, press = false, co = 0;
  if (t >= b(4.6) && t < D + .1) {
    co = seg(t, b(4.6), b(5)) * (1 - seg(t, D + .02, D + .1));
    const [qx, qy, qp] = searchCursor(t);
    if (t < T_UP1) { cx = qx; cy = qy; press = qp; }
    else { cx = track(t, [[T_UP1, REST[0]], [b(26), 250], [b(27.2), 214]]); cy = track(t, [[T_UP1, REST[1]], [b(26), 300], [b(27.2), 222]]); }
    const tr = t > T_STOP && t < T_SLAM + .25 ? 1.6 * E.io(seg(t, T_STOP, T_SLAM)) : 0;   // the hand trembles with anger
    cx += tr * Math.sin(t * 97); cy += tr * Math.sin(t * 83 + 1);
    hand = t > b(27.1); press = press || (t > D - .07 && t < D + .06);
  }

  const rowEl = (row: Row) => {
    const j = fallIdx.get(row.id), fall = falling && j !== undefined ? fallXf(row.id, j, t, T_SLAM) : null;
    const st: React.CSSProperties = fall ? { transform: fall.transform, transformOrigin: fall.origin, position: 'relative', zIndex: 3,
      background: dark ? `rgba(38,39,43,${fall.tip})` : `rgba(255,255,255,${fall.tip})`,
      boxShadow: dark ? `0 ${6 * fall.tip}px ${18 * fall.tip}px rgba(0,0,0,${.45 * fall.tip}),0 0 0 1px rgba(255,255,255,${.08 * fall.tip})` : `0 ${6 * fall.tip}px ${18 * fall.tip}px rgba(30,45,90,${.16 * fall.tip}),0 0 0 1px rgba(30,45,90,${.08 * fall.tip})` }
      : falling ? { visibility: 'hidden' } : {};
    if (row.kind === 'folder') return <div key={row.id} className="frow" style={st}><Ico n="FolderOpen" /><span>{row.title}</span></div>;
    return <div key={row.id} className={`srow${row === hov || row === opened ? ' sel' : ''}`} style={st}>
      {row.dot && <span className="gd" />}<span className="tt">{row.title}</span><span className="mt">{row.age}</span></div>;
  };
  // only rows near the visible list area are built
  const vis = ROWS.filter(row => { const y = LIST.top + row.top - sc; return y > 300 && y < 1100; });
  const lead = vis.length ? vis[0].top : 0;

  return (
    <div className="viewer" style={{ perspective: `${cc.perspective}px`, transform: open2d, opacity: openOp * winOp, borderRadius: radius }}>
      <div className="camera" style={{ transform: cc.transform }}>
        <div className="wallobj" style={{ transform: cssObject(WALL_M), opacity: seg(t, CLICK_DSH, WIN_OPEN + .4) * .9 }}>
          {WALL.map((c, i) => <div key={i} className="wchip" style={{ left: c.x, top: c.y }}>{c.text}</div>)}
        </div>
        <div className="winobj" style={{ transform: cssObject(new THREE.Matrix4()) }}>
          <div className="winz" style={{ zoom: WZ, transform: `scale(${1 / WZ})` } as React.CSSProperties}>
            <div className="win">
              <div className="side">
                <Ico n="Wordmark" className="logo" />
                <Ico n="PanelLeft" className="pbtn" style={{ width: 26, height: 26 }} />
                <div className="newbtn"><Ico n="NewChat" style={{ width: 20, height: 20 }} /><span>New session</span></div>
                <div className="one" style={{ boxShadow: oneGlow, borderColor: gl > .3 ? (dark ? '#5f8fb8' : '#f5b680') : undefined,
                  transform: `scale(${(t > b(27.2) && t < D ? 1.02 : 1) * (t > D - .09 && t < D + .05 ? .975 : 1)})`, visibility: t >= D ? 'hidden' : 'visible' }}>
                  <span className="osym" /><span className="ocopy"><span className="otitle"><span className="owm"><span className="othe">The</span><span className="oone">One<span className="odot" /></span></span><span className="olab">Main chat</span></span><span className="osub">Pick up the conversation</span></span>
                </div>
                <div className="nav" style={{ top: 285 }}><Ico n="FlatList" /><span>Topic workspaces</span></div>
                <div className="nav" style={{ top: 338 }}><Ico n="CordisPlugin" /><span>Plugins</span></div>
                <div className="wsh"><span>Workspaces</span><span className="ics"><Ico n="Search" /><Ico n="SlidersTwo" /><Ico n="ProjectAdd" /></span></div>
                <div className="list" style={falling ? { overflow: 'visible', WebkitMaskImage: 'none' } : undefined}>
                  <div className="lin" style={{ transform: `translateY(${lead - sc}px)` }}>{vis.map(rowEl)}</div>
                </div>
                <div className="bot" style={{ top: 980 }}><Ico n="Data" /><span>Context</span></div>
                <div className="bot" style={{ top: 1040 }}><Ico n="Settings" /><span>Settings</span></div>
              </div>
              <div className="main">
                <div className="mtop"><span>{opened ? opened.title : 'Untitled'}</span><span className="tag"><Ico n="Users" />Agent team</span><span className="tag"><Ico n="Gauge" />Standard</span></div>
                <div className="mtabs"><span className="on">Chat</span><span>Context</span></div>
                <div className="mline" />
                <div className="chat" style={{ opacity: msgIn, transform: `translateY(${(1 - E.o(msgIn)) * 14}px)` }}>
                  {msgs.map(([k, x], i) => {
                    const fall = falling ? fallXf(1000 + i, msgs.length - 1 - i, t, T_SLAM + .25) : null;
                    const st = fall ? { transform: fall.transform, transformOrigin: fall.origin } : undefined;
                    return <div key={i} className={k === 'u' ? 'ub' : k === 's' ? 'st' : 'at'} style={st}>{x}</div>;
                  })}
                </div>
                <div className="inp"><div className="ph">Send a message or create a task, /commands, @files or chats</div><div className="pl"><Ico n="Plus" /></div><div className="sd">↑</div></div>
              </div>
              <div className="dimW" style={{ opacity: dimO }} />
              <div className="cur" style={{ opacity: co, transform: `translate(${cx - (hand ? 9 : 3)}px,${cy - 3}px) scale(${press ? .86 : 1})` }}>{hand ? HAND : ARROW}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

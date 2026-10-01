'use strict';
/* TheOne — 30s vertical film. Every frame is a pure function of t. */
const $ = s => document.querySelector(s);
const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const clamp = (x, a = 0, b = 1) => x < a ? a : x > b ? b : x;
const lerp = (a, b, p) => a + (b - a) * p;
const seg = (t, a, b) => clamp((t - a) / (b - a));
const E = {
  l: x => x, i: x => x * x * x, o: x => 1 - Math.pow(1 - x, 3), io: x => x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2,
  oe: x => x >= 1 ? 1 : 1 - Math.pow(2, -10 * x), ie: x => x <= 0 ? 0 : Math.pow(2, 10 * x - 10),
  ioe: x => x <= 0 ? 0 : x >= 1 ? 1 : x < .5 ? Math.pow(2, 20 * x - 10) / 2 : (2 - Math.pow(2, -20 * x + 10)) / 2,
  ioq: x => x < .5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2, oq: x => 1 - (1 - x) * (1 - x), iq: x => x * x,
  ob: x => { const c1 = 1.4, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); },
};
function track(t, keys) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1, e] = keys[i];
    if (t <= t1) { const [t0, v0] = keys[i - 1]; const f = E[e || 'io'](t1 === t0 ? 1 : (t - t0) / (t1 - t0)); return Array.isArray(v0) ? v0.map((a, j) => lerp(a, v1[j], f)) : lerp(v0, v1, f); }
  }
  return keys[keys.length - 1][1];
}
function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const show = (el, v) => { const d = v ? '' : 'none'; if (el.style.display !== d) el.style.display = d; };
const op = (el, v) => { el.style.opacity = v; };
const text = (el, v) => { if (el.textContent !== v) el.textContent = v; };
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const I = window.DSH_ICONS; const ic = (n, cls = '') => `<span class="ico ${cls}">${I[n]}</span>`;

/* ---------------------------------------------------------- beat grid */
// theme: film.html?theme=dark renders the night version (DSH dark theme, the plugin's pale-blue accent)
const DARK = new URLSearchParams(location.search).get('theme') === 'dark';
if (DARK) document.documentElement.dataset.theme = 'dark';
// W(r,g,b): a warm accent colour by day; at night the same light mapped into the plugin's pale blue (#93c8f3)
function W(r, g, b) { if (!DARK) return `${r},${g},${b}`; const m = [b, g, r], t0 = [147, 200, 243]; return m.map((v, i) => Math.round(v * .45 + t0[i] * .55)).join(','); }
function sliceCol(k0, e0) {
  if (DARK) return `rgb(${Math.round(lerp(26, 64, k0) + e0 * .45)},${Math.round(lerp(40, 100, k0) + e0 * .75)},${Math.round(lerp(56, 134, k0) + e0)})`;
  return `rgb(${Math.round(Math.min(255, lerp(196, 244, k0) + e0))},${Math.round(lerp(112, 178, k0) + e0)},${Math.round(lerp(52, 120, k0) + e0 * .6)})`;
}
const FACE = DARK ? 'face_dark.png' : 'face.png';
const SH = 2160, CYS = SH / 2;   // 9:18 stage (1080×2160); the 1080×1920 design sits in its middle
const BEAT = 60 / 77, D = 20 * BEAT;            // drop = BGM 1:33.279
const b = k => k * BEAT, r = k => D + k * BEAT;  // r(1), r(2.25), r(3) are the bar's hard hits
const TOTAL = +(r(28.75) + 0.3).toFixed(3);
const CUES = []; const cue = (t, type, o = {}) => CUES.push({ t: +t.toFixed(4), type, ...o });
window.CUES = CUES; window.TOTAL = TOTAL; window.DROP = D;

/* ---------------------------------------------------------- desktop */
const deskWorld = $('#deskWorld');
const DOCK_X = [270, 380, 490, 600, 710];
deskWorld.innerHTML = `<div class="wall"></div><div class="dock"></div>
  <div class="dicon" style="left:${DOCK_X[0]}px;background:linear-gradient(180deg,#6cc6ff,#1f7ae0)"><svg viewBox="0 0 100 100"><path d="M24 34a6 6 0 0 1 6-6h14l6 6h20a6 6 0 0 1 6 6v26a6 6 0 0 1-6 6H30a6 6 0 0 1-6-6z" fill="#fff" opacity=".92"/></svg></div>
  <div class="dicon" style="left:${DOCK_X[1]}px;background:linear-gradient(180deg,#fff6cf,#ffd45c)"><svg viewBox="0 0 100 100"><g stroke="#b88a1a" stroke-width="3" opacity=".6"><path d="M26 40h48M26 52h48M26 64h34"/></g></svg></div>
  <div class="dicon" style="left:${DOCK_X[2]}px;background:linear-gradient(180deg,#ff7a8a,#e2334f)"><svg viewBox="0 0 100 100"><path d="M44 30v32a8 8 0 1 1-5-7.4V36l22-5v24a8 8 0 1 1-5-7.4V31" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round"/></svg></div>
  <div class="dicon" id="dsh" style="left:${DOCK_X[3]}px">${I.Fish}</div>
  <div class="dicon" style="left:${DOCK_X[4]}px;background:linear-gradient(180deg,#8fe0b0,#18a058)"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="24" stroke="#fff" stroke-width="4" fill="none"/><path d="M58 42l-6 14-14 6 6-14z" fill="#fff"/></svg></div>
  <div class="ddot" style="left:${DOCK_X[0] + 46}px"></div><div class="ddot" id="dshDot" style="left:${DOCK_X[3] + 46}px;opacity:0"></div>`;
const ICON = { x: DOCK_X[3] + 50, y: 1710 };
const CLICK0 = b(1);
cue(CLICK0, 'click');
function deskCursor(t) {
  const u = E.io(seg(t, 0.02, CLICK0 - .08));
  const P = [[900, 1380], [940, 1600], [700, 1640], [ICON.x + 6, ICON.y + 4]], m = 1 - u;
  return [0, 1].map(k => m * m * m * P[0][k] + 3 * m * m * u * P[1][k] + 3 * m * u * u * P[2][k] + u * u * u * P[3][k]);
}
const DCAM = { x: 540, y: 960, z: 1 };
function sDesk(t, ov) {
  const vis = t < b(1.7); show($('#desk'), vis); if (!vis) return;
  const c = deskCursor(t), cd = deskCursor(Math.max(0, t - .14));
  const z = track(t, [[0, 2.5], [CLICK0, 2.3], [b(1.6), 1.6, 'o']]);
  let cx = (cd[0] + ICON.x) / 2, cy = (cd[1] + ICON.y) / 2 - 40;
  cx = clamp(cx, 540 / z, 1080 - 540 / z); cy = clamp(cy, CYS / z, 1920 - CYS / z);
  Object.assign(DCAM, { x: cx, y: cy, z });
  deskWorld.style.transform = `translate(540px,${CYS}px) scale(${z}) translate(${-cx}px,${-cy}px)`;
  deskWorld.style.filter = `blur(${4 * seg(t, CLICK0 + .1, b(1.5))}px) brightness(${1 - .15 * seg(t, CLICK0, b(1.5))})`;
  const pr = Math.abs(t - CLICK0) < .07 ? .92 : 1;
  const bounce = t > CLICK0 ? 1 - .1 * Math.sin(seg(t, CLICK0, CLICK0 + .35) * Math.PI) : 1;
  $('#dsh').style.transform = `scale(${pr}) translateY(${(1 - bounce) * 140}px)`;
  op($('#dshDot'), seg(t, CLICK0 + .1, CLICK0 + .2));
  ov.desk = { x: (c[0] - cx) * z + 540, y: (c[1] - cy) * z + CYS, s: z * 1.25, press: Math.abs(t - CLICK0) < .06, o: 1 - seg(t, CLICK0 + .15, CLICK0 + .3) };
}
const deskCur = h('div', 'cur'); deskCur.style.zIndex = 30; $('#stage').appendChild(deskCur);

/* ---------------------------------------------------------- window replica */
const w3 = $('#w3');
const win = h('div', 'win');
win.innerHTML = `
<div class="side">
  <div class="logo">${I.Wordmark}</div>
  <div class="pbtn ico" style="width:26px;height:26px">${I.PanelLeft}</div>
  <div class="newbtn">${ic('NewChat')}<span>New session</span></div>
  <div class="one" id="oneBtn"><span class="osym"></span><span class="ocopy"><span class="otitle"><span class="owm"><span class="othe">The</span><span class="oone">One<span class="odot"></span></span></span><span class="olab">Main chat</span></span><span class="osub">Pick up the conversation</span></span></div>
  <div class="nav" style="top:285px">${ic('FlatList')}<span>Topic workspaces</span></div>
  <div class="nav" style="top:338px">${ic('CordisPlugin')}<span>Plugins</span></div>
  <div class="wsh"><span>Workspaces</span><span class="ics">${ic('Search')}${ic('SlidersTwo')}${ic('ProjectAdd')}</span></div>
  <div class="list"><div class="lin" id="lin"></div></div>
  <div class="bot" style="top:980px">${ic('Data')}<span>Context</span></div>
  <div class="bot" style="top:1040px">${ic('Settings')}<span>Settings</span></div>
</div>
<div class="main" id="main">
  <div class="mtop"><span id="mtitle">TheOne · Main chat</span><span class="tag">${ic('Users')}Agent team</span><span class="tag">${ic('Gauge')}Standard</span></div>
  <div class="mtabs"><span class="on">Chat</span><span>Context</span></div>
  <div class="mline"></div>
  <div class="chat" id="mchat"></div>
  <div class="inp"><div class="ph">Send a message or create a task, /commands, @files or chats</div><div class="pl">${ic('Plus')}</div><div class="sd">↑</div></div>
</div>
<div id="dimW"></div><div id="halo"></div><div id="rays"></div>
<div class="cur" id="cur"></div>`;
w3.appendChild(win);
const ARROW = '<svg width="28" height="42" viewBox="0 0 24 36"><path d="M2 2 L2 28 L8.3 21.8 L12.7 32 L16.9 30.2 L12.5 20.2 L21.2 20.2 Z" fill="#111" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/></svg>';
const HAND = '<svg width="34" height="38" viewBox="0 0 32 36"><path d="M11 17V4.5a3 3 0 0 1 6 0V14a3 3 0 0 1 5.2 1.2 3 3 0 0 1 5 1.6 3 3 0 0 1 4 2.2V26c0 5.2-4 9-9 9h-5c-3.6 0-5.6-1.6-7.6-4.6L4.4 23a2.7 2.7 0 0 1 4.2-3.3z" fill="#fff" stroke="#111" stroke-width="1.8" stroke-linejoin="round"/></svg>';
const lin = $('#lin');
const POOL = ['Hello', 'Untitled', 'New session', 'Untitled', 'Q3 budget draft', 'Weekly report', 'Fix flaky CI test', 'SQL index help', 'Landing page copy',
  'Bug in CSV export', 'Interview questions', 'Release notes', 'Refactor auth flow', 'Habit tracker app', 'Cycling route, Sunday', 'Balcony herbs', 'Rust lifetimes',
  'Docker won’t start', 'Name ideas', 'Paper notes: RAG', 'Translate this email', 'Kyoto day plan', 'Recipe: tomato & egg', 'Cat on my keyboard', 'Is 77 BPM slow?',
  'Summarize this PDF', 'Meeting notes', 'Fix the chart colors', 'Rewrite intro', 'Pricing page ideas', 'Explain this regex', 'Trip budget', 'Email to landlord',
  'Slides outline', 'Untitled', 'New session', 'Continue from yesterday', 'That bug again', 'Where did we leave this?', 'Draft v2', 'Draft v3', 'Draft v3 (final)'];
const AGES = ['4m', '1h', '3h', '1d', '2d', '4d', '6d', '1w', '2w', '3w', '1mo', '2mo', '3mo', '5mo', '8mo', '1y'];
function genRows(n, seed, a0, a1) { const r0 = rng(seed); return Array.from({ length: n }, (_, i) => { let tt = POOL[Math.floor(r0() * POOL.length)]; if ((tt === 'Untitled' || tt === 'New session') && r0() < .5) tt += ` (${2 + Math.floor(r0() * 30)})`; return [tt, AGES[Math.min(AGES.length - 1, a0 + Math.floor((a1 - a0) * i / n))]]; }); }
const FOLDERS = [
  ['Inbox', true, [['Download this video at max bitrate', '4m', 1], ['Hello', '8d'], ['Can you control my computer?', '8d'], ['Hello', '10d'], ['archify-dsh plugin installed', '11d']], 'I'],
  ['Project A', true, genRows(26, 11, 1, 8), 'W'],
  ['Project B', true, genRows(24, 12, 3, 10), 'S'],
  ['Project C', true, genRows(22, 13, 5, 12), 'C'],
  ['Archive 2025', true, genRows(34, 14, 9, 15), 'A'],
  ['Unsorted', true, genRows(40, 15, 2, 15), 'U'],
  ['Old chats', true, genRows(26, 16, 12, 15), 'O'],
];
const ROWS = {};
FOLDERS.forEach(([name, open, ss, pre]) => {
  const f = h('div', 'frow' + (open ? '' : ' cl'), `${ic(open ? 'FolderOpen' : 'FolderClose')}<span>${name}</span>`); lin.appendChild(f);
  if (pre) ROWS['F' + pre] = f;
  const kids = h('div', 'kids'); lin.appendChild(kids); if (pre) ROWS['K' + pre] = kids;
  ss.forEach(([tt, mt, dot], i) => { const r0 = h('div', 'srow', `${dot ? '<span class="gd"></span>' : ''}<span class="tt">${esc(tt)}</span><span class="mt">${mt}</span>`); r0.dataset.title = tt; kids.appendChild(r0); if (pre) ROWS[pre + i] = r0; });
});
const cur = $('#cur');

/* main panel content per session */
const MAIN = {
  default: [['u', 'Download https://www.bilibili.com/video/BV1mSffBFE4A at the highest bitrate'], ['s', 'Done in 3s'], ['a', 'Saved to Desktop as 320 kbps M4A.']],
};
function mainFor(title, k) {
  const r0 = rng(k * 97 + 3), L = n => Array.from({ length: n }, () => 'x').length;
  const asks = ['Pick up where we left off?', 'Can you summarize this?', 'What did we decide last time?', 'Try again with the new numbers', 'Shorter, please', 'Where was that link?'];
  const ans = ['Here is a short summary of the thread so far, with the open questions at the end.', 'We compared three options and leaned toward the second one. The details are below.', 'Sure — I rewrote it in a more concise tone and kept your original structure.', 'I could not find that in this session. It may be in another chat.'];
  return [['u', asks[Math.floor(r0() * asks.length)]], ['s', `Done in ${2 + Math.floor(r0() * 7)}s`], ['a', ans[Math.floor(r0() * ans.length)]], ['u', asks[Math.floor(r0() * asks.length)]]];
}
let mainKey = '';
function setMain(title, k) {
  if (mainKey === title + k) return; mainKey = title + k;
  $('#mtitle').textContent = title;
  const msgs = title === 'TheOne · Main chat' ? MAIN.default : mainFor(title, k);
  $('#mchat').innerHTML = msgs.map(([t, x]) => t === 'u' ? `<div class="ub">${esc(x)}</div>` : t === 's' ? `<div class="st">${esc(x)}</div>` : `<div class="at">${esc(x)}</div>`).join('');
}

/* ---------------------------------------------------------- the search (pre-drop) */
// trackpad swipes: [start, distance(px), coast time(s)] — inertial, so speed is non-linear
const SWIPES = [[b(2), 560, 1.0 * BEAT], [b(3), 700, 1.0 * BEAT],
  [b(6), 760, .72 * BEAT], [b(6.75), 820, .72 * BEAT], [b(7.5), 520, .5 * BEAT],
  [b(10), 640, .5 * BEAT], [b(10.5), 700, .5 * BEAT], [b(11), 520, .25 * BEAT], [b(11.25), 560, .25 * BEAT], [b(11.5), 900, .5 * BEAT]];
const coast = u => (1 - Math.exp(-5 * clamp(u))) / (1 - Math.exp(-5));
function listScroll(t) { let s0 = 0; for (const [ts, d, T0] of SWIPES) if (t > ts) s0 += d * coast((t - ts) / T0); return s0; }
// scans: the cursor checks rows in order, then opens one and lingers
const REST = [262, 742];
const SCANS = [
  { hov: [b(4.25), b(4.5), b(4.75)], dy: 45, open: b(5), end: b(6) },
  { hov: [b(8.25), b(8.5), b(8.75), b(9)], dy: -45, open: b(9.25), end: b(10) },
];
const T_STOP = b(12), T_SLAM = b(13.5), T_UP0 = b(15.25), T_UP1 = b(16.25);
const T_WH0 = T_UP0, T_WH1 = T_UP1;
// sound: one flap per session that scrolls past the cursor
{ let last = -1, lt = -1; for (let t = b(2); t < T_STOP; t += .002) { const k = Math.floor(listScroll(t) / 45); if (k !== last) { const v = (listScroll(t + .01) - listScroll(t)) * 100; if (last >= 0 && t - lt > .03) { cue(t, 'flapk', { g: clamp(.45 + v / 2600, .45, 1.05) }); lt = t; } last = k; } } }
SCANS.forEach(sc0 => { sc0.hov.forEach(x => cue(x, 'hov')); cue(sc0.open, 'click', { g: .7 }); });
SWIPES.forEach(([ts], i) => cue(ts - .05, 'swipe', { g: i >= 5 ? 1.2 : .9 }));
cue(T_STOP, 'growl', { dur: T_SLAM - T_STOP + .1 }); cue(T_SLAM, 'slam');
{ const r0 = rng(55); for (let j = 0; j < 15; j++) cue(T_SLAM + .3 + j * .045 + r0() * .06, 'book', { g: .5 + r0() * .5 }); }
cue(T_UP0 - .05, 'whoosh', { dur: 1.1 }); cue(T_UP1, 'settle');
cue(b(16.4), 'pad', { dur: D - b(16.4) }); cue(D - 1.6, 'swell', { dur: 1.6 });
cue(D, 'click', { g: 1.1 }); cue(D, 'impact');

const G = {}; // geometry cache
function rowTop(el) { let y = 0, e = el; while (e && e !== lin) { y += e.offsetTop; e = e.offsetParent; } return y; }
const ALLROWS = [...lin.querySelectorAll('.frow,.srow')];
const FALL = new Map();
{ const r0 = rng(31); ALLROWS.forEach(el => FALL.set(el, { sgn: r0() < .5 ? -1 : 1, jit: r0(), spin: .6 + r0() * .8, dx: r0() })); }
let fallPlan = null;
function cursorAt(t, sc) {
  // returns [x, y, hand, press] in window coords during the search
  let x = REST[0], y = REST[1], press = false;
  for (const S of SCANS) {
    if (t < S.hov[0] - .2 || t > S.end + .05) continue;
    if (!S.pts) { const s1 = listScroll(S.hov[0]); const snap = y0 => { for (const el of ALLROWS) { if (!el.classList.contains('srow')) continue; const y1 = 452 + rowTop(el) - s1; if (y0 >= y1 - 1 && y0 < y1 + 46) return [y1 + 24, el]; } return [y0, null]; };
      S.pts = [...S.hov.map((h0, i) => [h0, ...snap(REST[1] + S.dy * (i + 1))]), [S.open, ...snap(REST[1] + S.dy * (S.hov.length + 1))]]; S.el = S.pts[S.pts.length - 1][2]; }
    const pts = S.pts;
    let px = REST[0], py = REST[1];
    for (let i = 0; i < pts.length; i++) { const [tt, yy] = pts[i]; const k = E.io(seg(t, tt - .14, tt - .02)); py = lerp(py, yy, k); px = lerp(px, REST[0] + (i % 2 ? -14 : 10), k); }
    const back = E.io(seg(t, S.end - .2, S.end + .05)); x = lerp(px, REST[0], back); y = lerp(py, REST[1], back);
    press = Math.abs(t - S.open) < .06;
  }
  return [x, y, false, press];
}
/* ---------------------------------------------------------- 3D: what is behind the button */
const ONE = { x: 186, y: 208 };
const ONE_HTML = `<span class="osym"></span><span class="ocopy"><span class="otitle"><span class="owm"><span class="othe">The</span><span class="oone">One<span class="odot"></span></span></span><span class="olab">Main chat</span></span><span class="osub">Pick up the conversation</span></span>`;
// a rounded slab: thin rounded-rect slices stacked in z form the body, the face sits on top
const SLICES = 30;
const lift = h('div', 'lay', Array.from({ length: SLICES }, (_, i) => `<div class="lf slice" data-i="${i}"></div>`).join('') + `<div class="lf top" id="lfT"><img class="facebm" src="${FACE}" alt=""><div class="rim" id="lfRim"></div><div class="sheen" id="lfS"></div></div>`);
Object.assign(lift.style, { width: '336px', height: '91px', borderRadius: '0' }); w3.appendChild(lift);
lift.querySelectorAll('.slice').forEach(el => { const k = +el.dataset.i / (SLICES - 1); el.style.background = sliceCol(k, 0); });
const router = h('div', 'lay glass', `<div class="rlab">ROUTER</div><svg class="ring" width="180" height="180" viewBox="0 0 180 180"><circle cx="90" cy="90" r="82" fill="none" stroke="${DARK ? 'rgba(200,215,240,.16)' : 'rgba(40,60,110,.16)'}" stroke-width="1.5"/><circle cx="90" cy="90" r="56" fill="none" stroke="${DARK ? 'rgba(200,215,240,.3)' : 'rgba(40,60,110,.28)'}" stroke-width="1.5" stroke-dasharray="4 7"/><circle cx="90" cy="90" r="9" fill="rgb(${W(255, 138, 42)})"/></svg><div class="rtag" id="rtag"></div>`);
Object.assign(router.style, { width: '520px', height: '300px' }); w3.appendChild(router);
const CARD_T = ['Trip to Kyoto', 'Q3 budget', 'Habit tracker', 'Cycling route', 'Weekly report', 'Balcony herbs', 'Auth refactor', 'Paper notes', 'Landing page'];
const CARDS = CARD_T.map((tt, i) => {
  const c = h('div', 'lay glass card', `<div class="ct">${tt}</div><div class="cl" style="width:${70 + (i * 37) % 25}%"></div><div class="cl" style="width:${45 + (i * 53) % 35}%"></div><div class="cm">session ${String(i + 1).padStart(2, '0')}</div>`);
  Object.assign(c.style, { width: '230px', height: '136px' }); w3.appendChild(c);
  return { el: c, x: ONE.x + ((i % 3) - 1) * 252, y: ONE.y + (Math.floor(i / 3) - 1) * 158 };
});
const NEWC = h('div', 'lay glass card', `<div class="ct">Cat feeder</div><div class="cl" style="width:60%"></div><div class="cl" style="width:40%"></div><div class="cm">new session</div>`);
Object.assign(NEWC.style, { width: '230px', height: '136px' }); w3.appendChild(NEWC);
const NEWP = { x: ONE.x + 2 * 252, y: ONE.y };
const Z = { lift: 160, router: -250, cards: -660, hist: -1000 };  // a clear gap between the router and the session cards, so they read as separate floors
// the history sheet holds four topic slots; later the slots square up into a deck that docks under the key
const ENV = h('div', 'lay'); ENV.style.width = ENV.style.height = '0px'; w3.appendChild(ENV);
const envAt = (el, x, y, z, extra = '') => { el.style.transform = `translate3d(${x}px,${y}px,${z}px) ${extra}`; };
const envBody = h('div', 'envp', `<div class="rlab">HISTORY</div>`); Object.assign(envBody.style, { width: '880px', height: '560px' }); ENV.appendChild(envBody);
envAt(envBody, ONE.x - 440, ONE.y - 280, 0);


const ov = $('#ov');
const beamSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); beamSvg.id = 'beams'; beamSvg.setAttribute('width', 1080); beamSvg.setAttribute('height', SH);
beamSvg.innerHTML = '<defs><filter id="bg2" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4"/></filter></defs>';
ov.appendChild(beamSvg);
const BEAMS = [];
function beam(a, bb, hot) { const g = document.createElementNS('http://www.w3.org/2000/svg', 'g'); g.innerHTML = `<line stroke="${hot ? `rgba(${W(255, 140, 40)},.55)` : (DARK ? 'rgba(150,175,220,.16)' : 'rgba(110,140,210,.22)')}" stroke-width="8" filter="url(#bg2)"/><line stroke="${hot ? `rgb(${W(255, 138, 42)})` : DARK ? 'rgba(160,185,230,.4)' : 'rgba(80,110,180,.5)'}" stroke-width="2"/>`; beamSvg.appendChild(g); const B = { g, a, b: bb }; BEAMS.push(B); return B; }
const B0 = beam([ONE.x, ONE.y + 46, Z.lift], [ONE.x, ONE.y, Z.router], true);
const BC = CARDS.map(c => beam([ONE.x, ONE.y, Z.router], [c.x, c.y, Z.cards]));
const BN = beam([ONE.x, ONE.y, Z.router], [NEWP.x, NEWP.y, Z.cards]);
const orb = h('div', 'orb'); ov.appendChild(orb);
// face-on, the key's face is drawn as a flat 2D bitmap fitted to its projected corners: 3D layers are raster-capped, 2D ones are not
const face2d = h('div', 'face2d', `<img src="${FACE}" alt=""><div class="rim2"></div>`); ov.insertBefore(face2d, ov.firstChild);
const bub = h('div', 'bub'); ov.appendChild(bub);
const CHIP_T = ['Q3 budget draft', 'Weekly report', 'Refactor auth flow', 'Habit tracker app', 'Paper notes: RAG', 'Rust lifetimes', 'Kyoto day plan', 'Kyoto day plan (2)', 'Trip budget', 'Balcony herbs', 'Recipe: tomato & egg', 'Cat on my keyboard'];
const CL = [{ name: 'PROJECT A', x: ONE.x - 215, y: ONE.y - 215, t: r(13) }, { name: 'PROJECT B', x: ONE.x + 215, y: ONE.y - 215, t: r(14.25) },
  { name: 'TRAVEL', x: ONE.x - 215, y: ONE.y + 35, t: r(15) }, { name: 'HOME', x: ONE.x + 215, y: ONE.y + 35, t: r(15.5) }];
const CHIP_CL = [0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3], SLOT = [5, 0, 9, 3, 11, 7, 1, 10, 4, 8, 2, 6];
const SLOTS = CL.map(c => { const el = h('div', 'slot', `<div class="sl">${c.name}</div>`); ENV.appendChild(el); envAt(el, c.x - 185, c.y - 46, 2); return el; });
const CHIPS = CHIP_T.map((tt, i) => { const r0 = rng(100 + i), sl = SLOT[i]; const el = h('div', 'chip3', esc(tt)); ENV.appendChild(el);
  return { el, i, x0: ONE.x - 330 + (sl % 4) * 220 + (r0() - .5) * 60, y0: ONE.y - 200 + Math.floor(sl / 4) * 160 + (r0() - .5) * 50, cl: CHIP_CL[i], k: i % 3, ph: r0() * 6 }; });
const motes = []; { const r0 = rng(21); for (let i = 0; i < 40; i++) { const m = h('div'); m.style.cssText = 'position:absolute;left:0;top:0;width:6px;height:6px;border-radius:50%;background:rgb(' + W(255, 176, 102) + ');box-shadow:0 0 12px 3px rgba(' + W(255, 150, 60) + ',.55)'; ov.appendChild(m); motes.push({ el: m, x: r0() * 1080, y: r0() * SH, sp: 20 + r0() * 70, ph: r0() * 6, s: .4 + r0() * 1.1 }); } }

// post-drop cues on the bar's hard hits (r1, r2.25, r3 …)
cue(r(1), 'layer'); cue(r(2.25), 'layer', { g: .9 }); cue(r(3), 'layer', { g: .8 });
cue(r(4), 'type'); cue(r(5), 'route', { n: 'G5' }); cue(r(6.25), 'hit', { n: 'C6' }); cue(r(7), 'route', { n: 'E5', g: .7 });
cue(r(8), 'type'); cue(r(9), 'route', { n: 'A5' }); cue(r(10.25), 'create'); cue(r(11), 'route', { n: 'C6', g: .6 });
cue(r(12), 'rise'); cue(r(13), 'snap'); cue(r(14.25), 'snap'); cue(r(15), 'snap'); cue(r(15.5), 'snap', { g: .8 });
cue(r(17), 'deck'); cue(r(17.5), 'squeeze'); cue(r(18.25), 'rise'); cue(r(19), 'stack', { g: 1.2 }); cue(r(19), 'layer'); cue(r(20), 'swoosh2'); cue(r(21), 'end');

let WM = new DOMMatrix();
function proj(p) { const q = WM.transformPoint(new DOMPoint(p[0], p[1], p[2])); const k = 2200 / (2200 - q.z); return [540 + (q.x - 540) * k, CYS + (q.y - CYS) * k, k]; }
const place = (el, x, y, z, w, hh, o, s = 1) => { el.style.transform = `translate3d(${x - w / 2}px,${y - hh / 2}px,${z}px) scale(${s})`; op(el, o); show(el, o > 0.001); };

function camAt(t) {
  // pre-drop: close, three-quarter angle on the list → whoosh up → frontal on The One
  if (t < D) {
    const drift = seg(t, b(1.4), T_STOP);
    const pre = { z: lerp(2.5, 2.68, E.io(drift)), cx: 200, cy: lerp(714, 702, drift), rx: 4, ry: 9, rz: 0, cz: 0 };  // list framed clear of the notch
    // anger: hand-held shake that builds, then the slam jolts it
    const sh = (t > T_STOP && t < T_SLAM + .6) ? (E.io(seg(t, T_STOP, T_SLAM)) * 1 + 2.2 * Math.exp(-Math.max(0, t - T_SLAM) * 9) * (t > T_SLAM ? 1 : 0)) * (1 - seg(t, T_SLAM + .3, T_SLAM + .6)) : 0;
    const n1 = Math.sin(t * 61) * .6 + Math.sin(t * 37 + 1) * .4, n2 = Math.sin(t * 53 + 2) * .6 + Math.sin(t * 29) * .4;
    pre.cx += sh * 3.2 * n1; pre.cy += sh * 3.2 * n2; pre.rz += sh * .35 * Math.sin(t * 43);
    // rise and swing to a slight low angle on The One, then a slow push
    const top = { z: track(t, [[T_UP1, 2.85], [D - .05, 3.2, 'io']]), cx: ONE.x, cy: ONE.y + 24, rx: track(t, [[T_UP1, 17], [D, 12]]), ry: 0, rz: 0, cz: 0 };
    const e = E.ioe(seg(t, T_UP0, T_UP1));
    const o = {}; for (const key in pre) o[key] = lerp(pre[key], top[key], e);
    return o;
  }
  const a = E.oe(seg(t, D, r(1.6)));
  const c = { z: lerp(3.2, 1.18, a), cx: ONE.x, cy: lerp(ONE.y + 24, ONE.y - 40, a), rx: lerp(12, 56, E.io(seg(t, D, r(1.6)))), ry: 0, rz: lerp(0, -24, E.io(seg(t, D, r(2)))), cz: lerp(0, -420, a) };
  c.rz += -10 * E.ioq(seg(t, r(2), r(12)));
  // shot C: dive to the history layer
  const k = E.io(seg(t, r(11.6), r(12.8)));
  c.cz = lerp(c.cz, Z.hist, k); c.z = lerp(c.z, 1.3, k); c.rx = lerp(c.rx, 22, k); c.rz = lerp(c.rz, 0, k); c.cy = lerp(c.cy, ONE.y + 20, k);
  // converge: pull back up to The One key
  // back off to see the whole envelope while it folds
  const kE = E.io(seg(t, r(16.6), r(17.2))), kE2 = E.io(seg(t, r(17.2), r(18.2)));
  c.z = lerp(c.z, 1.02, kE) + .14 * kE2; c.rx = lerp(c.rx, 34, kE); c.rz = lerp(c.rz, -8, kE); c.cy = lerp(c.cy, ONE.y + 30, kE);
  const k2 = E.io(seg(t, r(18.25), r(19)));
  c.cz = lerp(c.cz, Z.lift - 60, k2); c.z = lerp(c.z, 1.45, k2); c.rx = lerp(c.rx, 42, k2); c.rz = lerp(c.rz, -10, k2); c.cy = lerp(c.cy, ONE.y + 30, k2);
  // face-on and push into the word "One"
  const k3 = E.io(seg(t, r(19.9), r(21)));
  c.cz = lerp(c.cz, Z.lift, k3); c.z = lerp(c.z, 4.2, E.ie(seg(t, r(19.9), r(21))) * .6 + k3 * .4); c.rx = lerp(c.rx, 0, k3); c.rz = lerp(c.rz, 0, k3);
  c.cx = lerp(c.cx, ONE.x - 72, k3); c.cy = lerp(c.cy, ONE.y - 12, k3);
  return c;
}

function sApp(t, ovs) {
  const vis = t >= b(1) && t < r(21.4); show($('#appwrap'), vis); if (!vis) return;
  // window-open from the dock icon
  const aw = $('#appwrap');
  if (t < b(1.7)) {
    const p = E.oe(seg(t, CLICK0 + .02, b(1.55)));
    const ix = (ICON.x - DCAM.x) * DCAM.z + 540, iy = (ICON.y - DCAM.y) * DCAM.z + CYS;
    const s = lerp(.06, 1, p);
    aw.style.transform = `translate(${lerp(ix, 540, p) - 540 * s}px,${lerp(iy, CYS, p) - CYS * s}px) scale(${s})`;
    op(aw, seg(t, CLICK0, CLICK0 + .12)); aw.style.borderRadius = lerp(200, 0, p) + 'px'; aw.style.overflow = 'hidden';
  } else { aw.style.transform = 'none'; op(aw, 1); aw.style.overflow = ''; }

  const C = camAt(t);
  w3.style.transform = `translate(540px,${CYS}px) rotateX(${C.rx}deg) rotateY(${C.ry}deg) rotateZ(${C.rz}deg) scale3d(${C.z},${C.z},${C.z}) translate3d(${-C.cx}px,${-C.cy}px,${-C.cz}px)`;
  WM = new DOMMatrix().translate(540, CYS).rotateAxisAngle(1, 0, 0, C.rx).rotateAxisAngle(0, 1, 0, C.ry).rotateAxisAngle(0, 0, 1, C.rz).scale(C.z, C.z, C.z).translate(-C.cx, -C.cy, -C.cz);

  // ---- the search
  const sc = t < T_SLAM ? listScroll(t) : listScroll(T_SLAM);
  lin.style.transform = `translateY(${-sc}px)`;
  const [qx, qy, , qpress] = cursorAt(t, sc);
  const rowUnder = y0 => { for (const el of ALLROWS) { if (!el.classList.contains('srow')) continue; const y1 = 452 + rowTop(el) - sc; if (y0 >= y1 && y0 < y1 + 45) return el; } return null; };
  const scanning = SCANS.some(S => t > S.hov[0] - .2 && t < S.end);
  const hovEl = scanning && t < T_STOP ? rowUnder(qy) : null;
  let selEl = null; for (const S of SCANS) if (t >= S.open && S.el) selEl = S.el;
  ALLROWS.forEach(el => { el.classList.toggle('sel', el === selEl || el === hovEl); });
  if (selEl) setMain(selEl.dataset.title, ALLROWS.indexOf(selEl)); else setMain('Untitled', 0);
  // the slam: rows tip over and fall like books off a shelf
  const list = win.querySelector('.list');
  if (t >= T_SLAM && t < D + 1) {
    list.style.overflow = 'visible'; list.style.webkitMaskImage = 'none';
    if (!fallPlan) { fallPlan = []; const sF = listScroll(T_SLAM); ALLROWS.forEach(el => { const y1 = 452 + rowTop(el) - sF; el.dataset.vis = (y1 > 420 && y1 < 1000) ? '1' : '0'; if (el.dataset.vis === '1') fallPlan.push([el, y1]); }); fallPlan.sort((p0, p1) => p1[1] - p0[1]); }
    fallPlan.forEach(([el, y1], j) => {
      const F = FALL.get(el), t0 = T_SLAM + .04 + j * .045 + F.jit * .06, tau = Math.max(0, t - t0), tip = E.o(seg(t, t0, t0 + .1));
      const fy = tau > .1 ? .5 * 5200 * (tau - .1) ** 2 : 0, ang = F.sgn * (6 * tip + (tau > .1 ? (70 * (tau - .1) + 260 * (tau - .1) ** 2) * F.spin : 0));
      el.style.transformOrigin = F.sgn > 0 ? '100% 100%' : '0 100%';
      el.style.transform = `translate(${F.sgn * F.dx * 120 * Math.max(0, tau - .1)}px,${fy}px) rotate(${ang}deg)`;
      el.style.position = 'relative'; el.style.zIndex = 3;
      const card = tip;  // the row detaches as a solid card, like a book leaving the shelf
      el.style.background = card > 0 ? (DARK ? `rgba(38,39,43,${card})` : `rgba(255,255,255,${card})`) : ''; el.style.boxShadow = card > 0 ? (DARK ? `0 ${6 * card}px ${18 * card}px rgba(0,0,0,${.45 * card}),0 0 0 1px rgba(255,255,255,${.08 * card})` : `0 ${6 * card}px ${18 * card}px rgba(30,45,90,${.16 * card}),0 0 0 1px rgba(30,45,90,${.08 * card})`) : '';
    });
    ALLROWS.forEach(el => { if (el.dataset.vis === '0') el.style.visibility = 'hidden'; });
  } else {
    list.style.overflow = ''; list.style.webkitMaskImage = '';
    if (fallPlan) { ALLROWS.forEach(el => { el.style.transform = ''; el.style.visibility = ''; el.style.zIndex = ''; el.style.background = ''; el.style.boxShadow = ''; }); fallPlan = null; }
  }
  // motion blur from camera move
  const C2 = camAt(t - 1 / 60), vel = Math.hypot((C.cy - C2.cy) * C.z, (C.z - C2.z) * 600) * 60;
  const bl = t > T_UP0 - .1 && t < T_UP1 + .1 ? Math.min(50, vel / 260) : 0;
  if (bl > .4) { $('#vbg').setAttribute('stdDeviation', `0 ${bl.toFixed(1)}`); win.style.filter = 'url(#vb)'; } else win.style.filter = '';
  // depth of field: the far side of the window softens while we are angled
  $('#main').style.filter = C.ry > 2 ? `blur(${(C.ry / 9 * 2).toFixed(2)}px)` : '';

  // ---- the reveal light
  const g = seg(t, T_UP1 - .3, b(17.3));
  op($('#dimW'), t < D ? .82 * E.io(g) : lerp(.82, 0, seg(t, D, r(1))));
  op($('#rays'), 0);
  $('#rays').style.transform = `rotate(${(t - b(16)) * 6}deg)`;
  op($('#halo'), 0);
  const one = $('#oneBtn'), gl = t > T_WH1 ? track(t, [[T_UP1, .2], [b(18.3), .65], [D, 1]]) + .06 * Math.sin(t * 3.4) : 0;
  one.style.boxShadow = gl ? `0 0 ${30 + 90 * gl}px ${4 + 26 * gl}px rgba(${W(255, 140 + 40 * gl | 0, 60)},${.2 + .45 * gl}),0 0 ${10 + 20 * gl}px ${1 + 5 * gl}px rgba(${W(255, 236, 210)},${.35 * gl})` : '';
  one.style.borderColor = gl > .3 ? (DARK ? '#5f8fb8' : '#f5b680') : (DARK ? '#344d64' : '#eed3bb');
  one.style.transform = `scale(${(t > b(19.2) && t < D ? 1.02 : 1) * (t > D - .09 && t < D + .05 ? .975 : 1)})`;
  one.style.visibility = t >= D ? 'hidden' : 'visible';
  {
    const vis2 = t > T_UP1 - .2 && t < D + .35, o2 = vis2 ? E.io(seg(t, T_UP1 - .2, b(17.6))) * (1 - seg(t, D, D + .35)) : 0;
    show(preGlow, o2 > .01);
    if (o2 > .01) {
      const c = proj([186, 208.5, 0]), pa = proj([18, 208.5, 0]), pb = proj([354, 208.5, 0]), pc = proj([186, 163, 0]), pd = proj([186, 254, 0]);
      const L = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]), W = Math.hypot(pd[0] - pc[0], pd[1] - pc[1]), ang = Math.atan2(pb[1] - pa[1], pb[0] - pa[0]) * 180 / Math.PI;
      const g2 = Math.min(1.3, gl);
      if (!PREG) PREG = makeShapeGlow(preGlow, KEY_L, true);
      setShapeGlow(PREG, e => boxHull(186, 208.5, 168 - 14 + e, 45.5 - 14 + e, 0, 0), o2 * Math.min(1.4, .45 + .5 * g2), 14);
      const ry0 = preRays; ry0.style.width = ry0.style.height = '2200px'; ry0.style.transform = `translate(${c[0] - 1100}px,${c[1] - 1100}px) rotate(${(t - b(16)) * 5}deg) scale(${Math.max(.7, L / 650)})`;
      ry0.style.webkitMaskImage = `radial-gradient(ellipse ${L * .38}px ${W * .5}px at 1100px 1100px,transparent 0,transparent 70%,#000 100%),radial-gradient(circle at 1100px 1100px,#000 0,rgba(0,0,0,.5) 22%,transparent 50%)`;
      ry0.style.webkitMaskComposite = 'source-in'; op(ry0, o2 * (.12 + .2 * g2));
    }
  }
  const mv = t > T_WH1 && t < D + .3 ? seg(t, T_UP1, b(17)) * (1 - seg(t, D, D + .3)) : 0;
  motes.forEach(M => { if (!mv) { op(M.el, 0); return; } const y = ((M.y - (t - T_WH1) * M.sp) % SH + SH) % SH; M.el.style.transform = `translate(${M.x + 14 * Math.sin(t + M.ph)}px,${y}px) scale(${M.s})`; op(M.el, mv * (.35 + .65 * Math.abs(Math.sin(t * 1.7 + M.ph)))); });

  // ---- cursor (inside the window, so it shares the camera)
  let cx = 0, cy = 0, hand = false, press = false, co = 0;
  if (t >= b(1.6) && t < D + .1) {
    co = seg(t, b(1.6), b(1.9)) * (1 - seg(t, D + .02, D + .1));
    if (t < T_UP1) { cx = qx; cy = qy; press = qpress; }
    else { cx = track(t, [[T_UP1, REST[0]], [b(18), 250, 'io'], [b(19.2), 214, 'io']]); cy = track(t, [[T_UP1, REST[1]], [b(18), 300, 'io'], [b(19.2), 222, 'io']]); }
    // anger: the cursor trembles with the hand
    const tr = t > T_STOP && t < T_SLAM + .25 ? 1.6 * E.io(seg(t, T_STOP, T_SLAM)) : 0;
    cx += tr * Math.sin(t * 97); cy += tr * Math.sin(t * 83 + 1);
    hand = t > b(19.1); press = press || (t > D - .07 && t < D + .06);
  }
  show(cur, co > 0); op(cur, co);
  const shape = hand ? 'h' : 'a'; if (cur.dataset.s !== shape) { cur.innerHTML = hand ? HAND : ARROW; cur.dataset.s = shape; }
  cur.style.transform = `translate(${cx - (hand ? 9 : 3)}px,${cy - 3}px) scale(${press ? .86 : 1})`;

  // ---- behind the button
  const post = t >= D;
  op(win, post ? lerp(1, .07, E.io(seg(t, D, r(1.4)))) * (1 - seg(t, r(11.6), r(12.4))) : 1);
  // once the window has faded into the backdrop, drop its 3.3× layout zoom: at SS=3 that layer alone is the largest
  // raster on the page, and when Chrome runs out of tile memory it silently skips other layers on some frames
  const lowres = post && t > r(1.4); if (win.dataset.lowres !== String(lowres)) { win.dataset.lowres = String(lowres); win.style.zoom = lowres ? '1' : ''; win.style.transform = lowres ? 'none' : ''; }
  const dimC = 1 - E.io(seg(t, r(11.6), r(12.3)));
    const app = (t0, z0, z1) => [E.oe(seg(t, t0 - .08, t0 + .4)), lerp(z0, z1, E.oe(seg(t, t0 - .08, t0 + .4)))];
  const [ra, rz0] = app(r(1), 0, Z.router); place(router, ONE.x, ONE.y, rz0, 520, 300, post ? ra * dimC : 0);
  const liftZ = post ? lerp(0, Z.lift, E.oe(seg(t, D, r(1.2)))) : 0, liftS = post ? lerp(1, 1.5, E.oe(seg(t, D, r(1.4)))) : 1;
  place(lift, ONE.x, ONE.y, liftZ, 336, 91, post ? Math.max(dimC, E.io(seg(t, r(18.2), r(18.8)))) : 0, liftS);
  const TH = 28 * E.oe(seg(t, D, r(1))) * (1 - E.io(seg(t, r(20.1), r(20.8))));
  $('#lfT').style.transform = `translateZ(${TH}px)`;
  const flare = t > r(19) - .3 ? Math.max(Math.exp(-Math.max(0, t - r(19)) * 4) * (t > r(19) ? 1 : seg(t, r(19) - .3, r(19))), E.ie(seg(t, r(20.3), r(21)))) : 0;
  const gI = Math.min(1.6, .55 + .5 * pulse(t) + flare);
  $('#lfRim').style.boxShadow = `inset 0 0 0 1.5px rgba(${W(255, 196, 140)},${.55 + .3 * gI}),inset 0 0 ${14 + 18 * gI}px rgba(${W(255, 165, 85)},${.18 + .22 * gI})`;
  const hit0 = lastHit(t), su = (t - hit0) / .6; $('#lfS').style.backgroundPosition = `${lerp(130, -40, E.io(clamp(su)))}% 0`; op($('#lfS'), su >= 0 && su <= 1 ? Math.sin(Math.PI * su) : 0);
  lift.querySelectorAll('.slice').forEach(el => { const k0 = +el.dataset.i / (SLICES - 1), e0 = 26 * Math.min(1, pulse(t) + flare) * k0; el.style.background = sliceCol(k0, e0); });
  {
    const zf = liftZ + TH, S = liftS;
    const tl = proj([ONE.x - 168 * S, ONE.y - 45.5 * S, zf]), tr = proj([ONE.x + 168 * S, ONE.y - 45.5 * S, zf]), bl = proj([ONE.x - 168 * S, ONE.y + 45.5 * S, zf]);
    const tilt = C.rx, front = post ? 1 - seg(tilt, 14, 22) : 0, lo = post ? Math.max(dimC, E.io(seg(t, r(18.2), r(18.8)))) : 0;
    show(face2d, front * lo > .001);
    if (front * lo > .001) { face2d.style.transform = `matrix(${(tr[0] - tl[0]) / 336},${(tr[1] - tl[1]) / 336},${(bl[0] - tl[0]) / 91},${(bl[1] - tl[1]) / 91},${tl[0]},${tl[1]})`; op(face2d, front * lo); face2d.querySelector('.rim2').style.boxShadow = $('#lfRim').style.boxShadow; }
    op($('#lfT'), 1 - front * .999);
  }
  drawGlow(t, post, liftZ, liftS, TH, Math.max(dimC, E.io(seg(t, r(18.2), r(18.8)))) * (t >= D ? 1 : 0), gI, flare, ra * dimC);
  lift.querySelectorAll('.slice').forEach(el => { el.style.transform = `translateZ(${(+el.dataset.i / (SLICES - 1) * (TH - .6)).toFixed(2)}px)`; el.style.display = TH > .5 ? '' : 'none'; });
  CARDS.forEach((c, i) => { const [ca, cz0] = app(r(2.25) + (i % 3) * .03 + Math.floor(i / 3) * .03, Z.router, Z.cards); place(c.el, c.x, c.y, cz0, 230, 136, post ? ca * dimC : 0); });
  const [ha, hz0] = app(r(3), Z.cards, Z.hist);
  // the squared deck rises and docks under the key on r19, becoming part of its thickness
  const kl = E.ie(seg(t, r(18.25), r(19))), dockZ = Z.lift - 32;
  const flat = E.io(seg(t, r(20.1), r(20.6)));
  show(ENV, post && ha > 0 && t < r(20.6));
  ENV.style.transform = `translate3d(0,0,${lerp(hz0, dockZ, kl) + 20 * flat}px)`;
  op(envBody, ha * (1 - seg(t, r(17), r(17.4))) * (1 - .55 * seg(t, r(4), r(5)) * (1 - seg(t, r(11), r(11.8)))));
  const nk = seg(t, r(10.25) - .1, r(10.25) + .35); place(NEWC, NEWP.x, NEWP.y, Z.cards, 230, 136, post ? Math.min(1, nk * 3) * dimC : 0, lerp(.6, 1, E.ob(nk)));
  // card highlight
  const hot0 = t > r(6.25) && t < r(8), hot1 = t > r(10.25) && t < r(12);
  CARDS[0].el.style.borderColor = hot0 ? `rgb(${W(255, 176, 112)})` : ''; CARDS[0].el.style.boxShadow = '';
  NEWC.style.borderColor = hot1 ? `rgb(${W(255, 176, 112)})` : ''; NEWC.style.boxShadow = '';
  // router tag
  const tag = t > r(9) ? 'CREATE' : t > r(5) ? 'SWAP' : ''; const rt = $('#rtag'); text(rt, tag);
  op(rt, tag ? (t > r(9) ? seg(t, r(9), r(9) + .1) : seg(t, r(5), r(5) + .1)) * (1 - seg(t, r(11.5), r(12))) : 0);
  router.style.boxShadow = '';
  const land = (t0, hold = 0) => t < t0 ? seg(t, t0 - .04, t0) : hold + (1 - hold) * Math.exp(-(t - t0) * 3.5);
  const hotR = Math.max(land(r(5)) * (1 - seg(t, r(5.6), r(6))), land(r(9)) * (1 - seg(t, r(9.6), r(10))));
  const hC0 = land(r(6.25), .55) * (1 - seg(t, r(7.8), r(8.2))), hC1 = land(r(10.25), .55) * (1 - seg(t, r(11.6), r(12)));
  drawHalo('hR', [ONE.x, ONE.y, Z.router], 260, 150, post ? hotR * ra * dimC : 0, 22);
  drawHalo('hC0', [CARDS[0].x, CARDS[0].y, Z.cards], 115, 68, post ? hC0 * dimC * (1 + .4 * pulse(t)) : 0, 16);
  drawHalo('hC1', [NEWP.x, NEWP.y, Z.cards], 115, 68, post ? hC1 * dimC * (1 + .4 * pulse(t)) : 0, 16);

  // overlay: beams, orb, bubble, chips
  show(ov, true);
  const bo = post ? seg(t, r(3.2), r(4)) * (1 - seg(t, r(11.6), r(12.2))) : 0;
  const setB = (B, o) => { const p = proj(B.a), q = proj(B.b); B.g.querySelectorAll('line').forEach(l => { l.setAttribute('x1', p[0]); l.setAttribute('y1', p[1]); l.setAttribute('x2', q[0]); l.setAttribute('y2', q[1]); }); B.g.style.opacity = o; };
  setB(B0, bo); BC.forEach((B, i) => setB(B, bo * (i === 0 && hot0 ? 1 : .35))); setB(BN, post ? bo * Math.min(1, nk * 2) * (hot1 ? 1 : .35) : 0);
  const path = [];
  const P_ONE = [ONE.x, ONE.y, Z.lift], P_R = [ONE.x, ONE.y, Z.router], P_C0 = [CARDS[0].x, CARDS[0].y, Z.cards], P_N = [NEWP.x, NEWP.y, Z.cards];
  const flights = [[r(4.4), r(5), P_ONE, P_R], [r(5.15), r(6.25), P_R, P_C0], [r(6.4), r(7), P_C0, P_ONE], [r(8.4), r(9), P_ONE, P_R], [r(9.15), r(10.25), P_R, P_N]];
  let op0 = 0, pp = null;
  for (const [a, bb, p, q] of flights) if (t >= a && t <= bb + .05) { const k = E.iq(seg(t, a, bb)); pp = proj([lerp(p[0], q[0], k), lerp(p[1], q[1], k), lerp(p[2], q[2], k)]); op0 = 1; }
  if (pp) { orb.style.transform = `translate(${pp[0]}px,${pp[1]}px)`; } op(orb, op0);
  const bubs = [[r(4), r(5.2), 'Kyoto, day 3?', 0], [r(7), r(8), 'Arashiyama at 9 am.', 1], [r(8), r(9.2), 'New topic: a cat feeder', 0]];
  let bb0 = null; for (const x of bubs) if (t >= x[0] && t < x[1]) bb0 = x;
  if (bb0) { const p = proj([ONE.x, ONE.y - 30, Z.lift + 10]); text(bub, bb0[2]); bub.className = 'bub' + (bb0[3] ? ' r' : ''); const k = E.ob(seg(t, bb0[0], bb0[0] + .25)); bub.style.transform = `translate(${p[0]}px,${p[1]}px) translate(-50%,-160%) scale(${lerp(.7, 1, k)})`; op(bub, seg(t, bb0[0], bb0[0] + .08) * (1 - seg(t, bb0[1] - .12, bb0[1]))); } else op(bub, 0);
  const deckOf = i => {
    const Cc = CL[i], g = E.io(seg(t, r(17) - .05 + i * .04, r(17) + .32 + i * .04)), sq = E.io(seg(t, r(17.5) - .05, r(17.5) + .35));
    const cx = lerp(Cc.x, ONE.x + (i - 1.5) * 4 * (1 - sq), g), cy = lerp(Cc.y + 70, ONE.y + (i - 1.5) * 3 * (1 - sq), g);
    return { g, sq, cx, cy, z: lerp(2, 10 + i * 7, g), rot: g * (1 - sq) * (i - 1.5) * 2.5, sx: lerp(1, 504 / 370, sq), sy: lerp(1, 136.5 / 232, sq) };
  };
  CHIPS.forEach(c => {
    if (t <= r(11.6) || t >= r(18.4)) { op(c.el, 0); return; }
    const Cc = CL[c.cl], k = E.oe(seg(t, Cc.t - .1, Cc.t + .3));
    const tin = E.o(seg(t, r(11.6) + c.i * .03, r(12.3) + c.i * .03));
    const th = c.ph + (t - r(11.6)) * (1.1 + (c.i % 4) * .35) * (c.i % 2 ? 1 : -1);
    const rad = lerp(900, 150 + (c.i % 5) * 45, tin) + 30 * Math.sin(t * 3 + c.ph);
    const fx = ONE.x + Math.cos(th) * rad, fy = ONE.y - 60 + Math.sin(th) * rad * .75, fz = 110 + 80 * Math.sin(t * 1.7 + c.ph * 2);
    const tx = Cc.x, ty = Cc.y + 34 + c.k * 52;
    const q = 1 - k, rz = q * (28 * Math.sin(t * 2.3 + c.ph * 3) + (c.i % 2 ? 14 : -14)), rx = q * 70 * Math.sin(t * 1.9 + c.ph), ry = q * 55 * Math.cos(t * 1.3 + c.ph * 2);
    if (t < r(17) - .05) c.el.style.transform = `translate3d(${lerp(fx, tx, k)}px,${lerp(fy, ty, k)}px,${lerp(fz, 8, k)}px) translate(-50%,-50%) rotateZ(${rz}deg) rotateX(${rx}deg) rotateY(${ry}deg)`;
    else { const d0 = deckOf(c.cl); c.el.style.transform = `translate3d(${d0.cx}px,${d0.cy}px,${d0.z + 2}px) rotateZ(${d0.rot}deg) scale(${d0.sx},${d0.sy}) translate(${tx - Cc.x}px,${ty - Cc.y - 70}px) translate(-50%,-50%)`; }
    op(c.el, seg(t, r(11.6), r(11.9)) * (1 - seg(t, r(17.5), r(17.5) + .25)));
  });
  SLOTS.forEach((el, i) => {
    const d0 = deckOf(i), sq = d0.sq;
    el.style.transform = `translate3d(${d0.cx - 185}px,${d0.cy - 116}px,${d0.z}px) rotateZ(${d0.rot}deg) scale(${d0.sx},${d0.sy})`;
    const k0 = .25 + .1 * i;  // the cards take on the key's warm slice colours as they squeeze
    if (DARK) el.style.background = `linear-gradient(180deg,rgba(${lerp(32, lerp(40, 64, k0), sq) | 0},${lerp(34, lerp(62, 100, k0), sq) | 0},${lerp(40, lerp(86, 134, k0), sq) | 0},${lerp(.85, 1, sq)}),rgba(${lerp(32, 30, sq) | 0},${lerp(34, 48, sq) | 0},${lerp(40, 66, sq) | 0},${lerp(.85, 1, sq)}))`; else
    el.style.background = `linear-gradient(180deg,rgba(${lerp(255, lerp(214, 236, k0), sq) | 0},${lerp(255, lerp(132, 160, k0), sq) | 0},${lerp(255, lerp(70, 100, k0), sq) | 0},${lerp(.85, 1, sq)}),rgba(${lerp(255, 205, sq) | 0},${lerp(255, 120, sq) | 0},${lerp(255, 58, sq) | 0},${lerp(.85, 1, sq)}))`;
    el.style.borderStyle = sq > .3 ? 'solid' : 'dashed'; el.style.borderColor = DARK ? `rgba(147,200,243,${lerp(.35, .5, sq)})` : `rgba(${lerp(200, 230, sq) | 0},${lerp(120, 140, sq) | 0},50,${lerp(.35, .5, sq)})`;
    el.style.boxShadow = d0.g > 0 ? `0 ${8 * d0.g}px ${20 * d0.g}px rgba(${DARK ? '0,0,0' : '120,70,20'},${(DARK ? .4 : .12) * d0.g})` : '';
    op(el, seg(t, r(11.7), r(12.2)) * (1 - seg(t, r(20.1), r(20.6))));
    el.querySelector('.sl').style.opacity = (.35 + .65 * seg(t, CL[i].t, CL[i].t + .15)) * (1 - seg(t, r(17.5), r(17.5) + .2));
  });
}
const preGlow = h('div', null); preGlow.id = 'preGlow'; preGlow.style.cssText = 'position:absolute;left:0;top:0;width:1080px;height:' + SH + 'px;pointer-events:none;z-index:2'; let PREG = null;
const preRays = h('div', 'gl3 grays'); preGlow.appendChild(preRays);
const glowL = h('div', null); glowL.id = 'glowLayer'; glowL.style.cssText = 'position:absolute;left:0;top:0;width:1080px;height:' + SH + 'px;pointer-events:none;z-index:0'; $('#cam').insertBefore(glowL, w3); $('#cam').insertBefore(preGlow, $('#ov'));
glowL.innerHTML = `<svg id="cone" width="1080" height="${SH}" style="position:absolute;left:0;top:0;overflow:visible"><defs><filter id="coneB" filterUnits="userSpaceOnUse" x="-600" y="-600" width="2280" height="3360"><feGaussianBlur stdDeviation="7"/></filter></defs><g id="coneP" filter="url(#coneB)"></g><g id="coneP2" filter="url(#coneB)"></g></svg>
  <div class="gl3 grays"></div><div class="gl3 gstreak"></div><div class="gl3 gstreak2"></div>`;
const hull = P => { P = P.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]); const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); const lo = [], up = []; for (const p of P) { while (lo.length > 1 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); } for (const p of P.reverse()) { while (up.length > 1 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); } return lo.slice(0, -1).concat(up.slice(0, -1)); };
// glow that follows an object's real projected outline: the hull of its box corners, rounded by a
// round-joined stroke, drawn as three blurred layers (edge, bloom, haze) — no more screen ellipses
const SVGNS = 'http://www.w3.org/2000/svg'; let glowSeq = 0;
function makeShapeGlow(parent, layers, withMask) {
  const svg = document.createElementNS(SVGNS, 'svg'); svg.setAttribute('width', 1080); svg.setAttribute('height', SH); svg.style.cssText = 'position:absolute;left:0;top:0;overflow:visible';
  const id = 'sg' + (glowSeq++); let defs = '', body = '';
  layers.forEach((L, i) => { defs += `<filter id="${id}f${i}" filterUnits="userSpaceOnUse" x="-600" y="-600" width="2280" height="3120"><feGaussianBlur stdDeviation="1"/></filter>`; body += `<path class="L${i}" fill="${L.col}" stroke="${L.col}" stroke-linejoin="round" filter="url(#${id}f${i})"/>`; });
  if (withMask) defs += `<mask id="${id}m" maskUnits="userSpaceOnUse" x="-600" y="-600" width="2280" height="3120"><rect x="-600" y="-600" width="2280" height="3120" fill="#fff"/><path class="hole" fill="#000" stroke="#000" stroke-linejoin="round"/></mask>`;
  svg.innerHTML = `<defs>${defs}</defs><g ${withMask ? `mask="url(#${id}m)"` : ''}>${body}</g>`;
  parent.appendChild(svg);
  return { svg, layers, paths: layers.map((_, i) => svg.querySelector('.L' + i)), blurs: layers.map((_, i) => svg.querySelector(`#${id}f${i} feGaussianBlur`)), hole: svg.querySelector('.hole') };
}
function boxHull(cx, cy, hw, hh, z0, z1) {
  const pts = []; for (const z of (z0 === z1 ? [z0] : [z0, z1])) for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const p = proj([cx + sx * hw, cy + sy * hh, z]); pts.push([p[0], p[1]]); }
  const H = hull(pts), a = proj([cx - hw, cy, z1]), b0 = proj([cx + hw, cy, z1]);
  return { d: 'M' + H.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join('L') + 'Z', s: Math.hypot(b0[0] - a[0], b0[1] - a[1]) / (2 * hw) };
}
// mk(e) returns the projected hull of the object's rectangle inflated by e world px, so the spread is
// foreshortened by perspective exactly like the object itself
function setShapeGlow(G, mk, o, rad, k = 1) {
  const on = o > .005; G.svg.style.display = on ? '' : 'none'; if (!on) return;
  G.layers.forEach((L, i) => { const sh = mk(L.e * k), p0 = G.paths[i]; p0.setAttribute('d', sh.d); p0.setAttribute('stroke-width', Math.max(1, 2 * rad * sh.s).toFixed(1)); p0.style.opacity = Math.min(1, o * L.o).toFixed(3); G.blurs[i].setAttribute('stdDeviation', Math.max(.5, L.b * k * sh.s).toFixed(1)); });
  if (G.hole) { const sh = mk(0); G.hole.setAttribute('d', sh.d); G.hole.setAttribute('stroke-width', Math.max(1, 2 * rad * sh.s - 2).toFixed(1)); }
}
const KEY_L = [{ col: `rgb(${W(255, 150, 60)})`, e: 5, b: 5, o: DARK ? .55 : .6 }, { col: `rgb(${W(255, 160, 80)})`, e: 24, b: 12, o: DARK ? .34 : .4 }, { col: `rgb(${W(255, 180, 118)})`, e: 70, b: 28, o: DARK ? .12 : .15 }];
const HALO_L = [{ col: `rgb(${W(255, 150, 60)})`, e: 4, b: 4, o: DARK ? .5 : .6 }, { col: `rgb(${W(255, 165, 85)})`, e: 18, b: 9, o: DARK ? .32 : .38 }, { col: `rgb(${W(255, 182, 120)})`, e: 54, b: 22, o: DARK ? .11 : .14 }];
const HALOS = {};
const CONE_F = `rgb(${W(255, 190, 130)})`, CONE_S = `rgb(${W(255, 170, 95)})`;
// routing wavefronts are real planes in the 3D world: depth decides what covers them, so a wave travelling from the
// router down to a card passes under the router and over the cards
const WAVES = [0, 1].map(() => [0, 1, 2].map(() => {
  const e = h('div', 'lay'); e.style.cssText += `;border:3px solid ${CONE_S};border-radius:14px;background:rgba(${W(255, 190, 130)},.07);` +
    `box-shadow:0 0 18px 6px rgba(${W(255, 160, 80)},.5),inset 0 0 14px rgba(${W(255, 190, 130)},.45);pointer-events:none;display:none`;
  w3.appendChild(e); return e;
}));
function drawHalo(id, P, hw, hh, o, rad = 18) {
  if (!HALOS[id]) HALOS[id] = makeShapeGlow(glowL, HALO_L, false);
  setShapeGlow(HALOS[id], e => boxHull(P[0], P[1], hw - rad + e, hh - rad + e, P[2], P[2]), o, rad);
}
let KEYG = null;
function drawGlow(t, post, z, S, TH, o, gI, flare, coneO) {
  show(glowL, post); glowL.querySelectorAll('.grays,.gstreak,.gstreak2,#cone').forEach(e => e.style.visibility = o > .01 ? '' : 'hidden'); if (KEYG && !(o > .01)) KEYG.svg.style.display = 'none'; if (!(post && o > .01)) { WAVES.forEach(rs => rs.forEach(e => { e.style.display = 'none'; })); return; }
  const zc = z + TH * .5, c = proj([ONE.x, ONE.y, zc]);
  const pa = proj([ONE.x - 168 * S, ONE.y, zc]), pb = proj([ONE.x + 168 * S, ONE.y, zc]), pc = proj([ONE.x, ONE.y - 45.5 * S, zc]), pd = proj([ONE.x, ONE.y + 45.5 * S, zc]);
  const L = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]), W = Math.max(30, Math.hypot(pd[0] - pc[0], pd[1] - pc[1]) + TH * S * c[2]), ang = Math.atan2(pb[1] - pa[1], pb[0] - pa[0]) * 180 / Math.PI;
  const at = (cls, w, hh, rot, opv, sc = 1) => { const el = glowL.querySelector('.' + cls); el.style.width = w + 'px'; el.style.height = hh + 'px'; el.style.transform = `translate(${c[0] - w / 2}px,${c[1] - hh / 2}px) rotate(${rot}deg) scale(${sc})`; op(el, opv); };
  if (!KEYG) KEYG = makeShapeGlow(glowL, KEY_L, false);
  setShapeGlow(KEYG, e => boxHull(ONE.x, ONE.y, (168 - 12) * S + e, (45.5 - 12) * S + e, z, z + TH), o * Math.min(1.5, .55 + .5 * gI), 12 * S, S);
  at('grays', 1900, 1900, (t - D) * 4, o * Math.min(.5, .16 + .22 * gI), Math.max(.6, L / 700));
  at('gstreak', L * 3.4, 6, ang, o * Math.min(1, .25 + .9 * (pulse(t) + flare)));
  at('gstreak2', L * 1.9, 26, ang, o * Math.min(.8, .12 + .5 * (pulse(t) + flare)));
  // the routing light travels level by level: key → router (lands on r5 / r9), router → session (lands on r6¼ / r10¼)
  const KEY = [ONE.x, ONE.y, 168 * S, 45.5 * S, z], RT = [ONE.x, ONE.y, 260, 150, Z.router];
  // wavefronts only where the next level sits straight below (key → router); a session card is off to the side, so a
  // wave morphing into it would sweep across the other cards; there the light travels as the orb alone
  const LEGS = [[r(4.4), r(5), KEY, RT], [r(8.4), r(9), KEY, RT]];
  // the wave is the key's rectangle carried down through 3D space into the target's rectangle, so every
  // wavefront has the same angle and perspective as the planes it travels between
  WAVES.forEach((rings, slot) => {
    let on = false;
    LEGS.forEach(([a0, a1, A, B], li) => {
      if (li % 2 !== slot || t < a0 - .05 || t > a1 + .35) return;
      on = true;
      const su = clamp((t - a0) / (a1 - a0)), sw = seg(t, a0 - .05, a0 + .1) * (1 - seg(t, a1 + .05, a1 + .35));
      const uu = lerp(.05, 1, E.iq(su));
      rings.forEach((el, i) => {
        const u = uu - i * .075; if (u < 0) { el.style.display = 'none'; return; }
        const R = A.map((v, j) => lerp(v, B[j], u)), w = 2 * R[2], hh = 2 * R[3];
        el.style.display = ''; el.style.width = w + 'px'; el.style.height = hh + 'px';
        el.style.transform = `translate3d(${R[0] - w / 2}px,${R[1] - hh / 2}px,${R[4]}px)`;
        el.style.opacity = (coneO * sw * .6 * (1 - i * .38)).toFixed(3);
      });
    });
    if (!on) rings.forEach(el => { el.style.display = 'none'; });
  });
}
function pulse(t) { if (t < D) return 0; const x = ((t - D) / BEAT) % 4, d = x - 1; return d >= 0 ? Math.exp(-d * 3.2) : 0; }
function lastHit(t) { const k = Math.floor(((t - D) / BEAT - 1) / 4); return D + (4 * k + 1) * BEAT; }

/* ---------------------------------------------------------- end card */
const endEl = $('#end');
endEl.innerHTML = `<div class="erays" id="erays"></div><div class="ewm ewg" id="ewg"><span class="t">The</span><span class="o">One<span class="d"></span></span></div><div class="ewm" id="ewm"><span class="t">The</span><span class="o">One<span class="d"></span></span></div>
  <div class="etag" id="etag">One chat. Every context.</div>
  <div class="eurl" id="eurl"><svg class="ghm" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg><span>YunongDai2005/dsh-theone</span></div>
  <div class="edisc" id="edisc">Community plugin for DSH · unofficial</div>`;
function sEnd(t) {
  const vis = t >= r(20.85); show(endEl, vis); if (!vis) return;
  op(endEl, seg(t, r(20.85), r(21.05)));
  const k = seg(t, r(21), r(21) + .6);
  // the logo's light swells on each bar's strongest hit (plus its own entrance)
  const P = Math.max(pulse(t), Math.exp(-Math.max(0, t - r(21)) * 3) * (t >= r(21) ? 1 : 0));
  $('#ewm').style.transform = `scale(${lerp(1.12, 1, E.oe(k)) * (1 + .02 * P)})`; op($('#ewm'), seg(t, r(21), r(21) + .15));
  const o = $('#ewm .o'); o.style.textShadow = `0 0 ${36 + 40 * P}px rgba(${W(255, 140, 50)},${.3 + .35 * P}),0 0 ${110 + 90 * P}px rgba(${W(255, 120, 30)},${.12 + .26 * P})`;
  $('#ewm .d').style.boxShadow = `0 0 ${20 + 30 * P}px rgba(${W(255, 140, 50)},${.55 + .4 * P})`;
  const hv = seg(t, r(21), r(21) + .4); const ewg = $('#ewg'); op(ewg, hv * (.35 + .5 * P)); ewg.style.transform = $('#ewm').style.transform; ewg.style.filter = `blur(${18 + 16 * P}px)`;
  op($('#erays'), hv * (.10 + .26 * P)); $('#erays').style.transform = `translate(-50%,-50%) rotate(${(t - r(21)) * 4}deg) scale(${1 + .06 * P})`;
  const up = (id, a) => { const el = $(id), p = seg(t, a, a + .4); op(el, p); el.style.transform = `translateY(${(1 - E.o(p)) * 24}px)`; };
  up('#etag', r(22.25)); up('#eurl', r(23)); up('#edisc', r(23.5));
}

/* ---------------------------------------------------------- global FX */
function sFX(t) {
  const f = Math.max(t >= D ? 1 - E.o(seg(t, D, D + .55)) : 0, t >= r(20.6) ? (t < r(21) ? .95 * E.ie(seg(t, r(20.6), r(21))) : .95 * (1 - E.o(seg(t, r(21), r(21) + .7)))) : 0);
  op($('#flash'), f);
  op($('#fade'), seg(t, TOTAL - .45, TOTAL));
}
function drawDeskCursor(o) {
  if (!o || !(o.o > 0)) { op(deskCur, 0); return; }
  if (!deskCur.dataset.s) { deskCur.innerHTML = ARROW; deskCur.dataset.s = 'a'; }
  deskCur.style.transform = `translate(${o.x - 3 * o.s}px,${o.y - 3 * o.s}px) scale(${o.s * (o.press ? .86 : 1)})`; op(deskCur, o.o);
}

function render(t) {
  if (!G.maxScroll) G.maxScroll = () => Math.max(0, lin.offsetHeight - 535);
  const ovs = {};
  sDesk(t, ovs); drawDeskCursor(ovs.desk);
  sApp(t, ovs); sEnd(t); sFX(t);
}
window.render = render;
// Keep the static card copy in the card's own background paint layer.
// Separate DOM glyph layers can disappear during perspective compositing.
let cardCopyReady = false;
async function bakeCardCopy() {
  if (cardCopyReady) return;
  await document.fonts.load('600 22px Inter');
  await document.fonts.load('500 13px "JetBrains Mono"');
  for (const el of [...CARDS.map(c => c.el), NEWC]) {
    const canvas = document.createElement('canvas');
    const scale = 4;
    canvas.width = 230 * scale; canvas.height = 136 * scale;
    const ctx = canvas.getContext('2d'); ctx.scale(scale, scale);
    for (const child of el.children) {
      const cs = getComputedStyle(child);
      const x = child.offsetLeft + el.clientLeft, y = child.offsetTop + el.clientTop;
      if (child.classList.contains('cl')) {
        ctx.fillStyle = cs.backgroundColor;
        ctx.beginPath(); ctx.roundRect(x, y, child.offsetWidth, child.offsetHeight, 4); ctx.fill();
      } else {
        ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
        ctx.fillStyle = cs.color; ctx.textBaseline = 'alphabetic';
        const metrics = ctx.measureText(child.textContent);
        const ascent = metrics.fontBoundingBoxAscent ?? metrics.actualBoundingBoxAscent;
        const descent = metrics.fontBoundingBoxDescent ?? metrics.actualBoundingBoxDescent;
        ctx.fillText(child.textContent, x, y + (child.offsetHeight - ascent - descent) / 2 + ascent);
      }
    }
    el.style.backgroundImage = `url(${canvas.toDataURL('image/png')})`;
    el.style.backgroundSize = '100% 100%'; el.style.backgroundOrigin = 'border-box';
    el.style.backgroundRepeat = 'no-repeat';
    for (const child of el.children) child.style.visibility = 'hidden';
  }
  cardCopyReady = true;
}
window.warm = async () => {
  const wasDisp = $('#appwrap').style.display; $('#appwrap').style.display = '';
  await document.fonts.ready;
  for (let t = 0; t < TOTAL; t += .3) render(t);
  await document.fonts.ready;
  // Lay out visible cards before measuring their static copy.
  render(22);
  await bakeCardCopy();
  render(0); await new Promise(r0 => setTimeout(r0, 300));
  return CUES.length;
};
if (!navigator.webdriver) window.warm().then(() => { const t0 = performance.now(); const loop = () => { render(((performance.now() - t0) / 1000) % TOTAL); requestAnimationFrame(loop); }; loop(); });

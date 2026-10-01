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
  ioq: x => x < .5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2, oq: x => 1 - (1 - x) * (1 - x),
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
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const I = window.DSH_ICONS; const ic = (n, cls = '') => `<span class="ico ${cls}">${I[n]}</span>`;

/* ---------------------------------------------------------- beat grid */
const BEAT = 60 / 77, D = 13 * BEAT;            // drop = BGM 1:33.279
const b = k => k * BEAT, r = k => D + k * BEAT;  // r(1), r(2.25), r(3) are the bar's hard hits
const TOTAL = +(r(19) + 0.75).toFixed(3);
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
  cx = clamp(cx, 540 / z, 1080 - 540 / z); cy = clamp(cy, 960 / z, 1920 - 960 / z);
  Object.assign(DCAM, { x: cx, y: cy, z });
  deskWorld.style.transform = `translate(540px,960px) scale(${z}) translate(${-cx}px,${-cy}px)`;
  deskWorld.style.filter = `blur(${4 * seg(t, CLICK0 + .1, b(1.5))}px) brightness(${1 - .15 * seg(t, CLICK0, b(1.5))})`;
  const pr = Math.abs(t - CLICK0) < .07 ? .92 : 1;
  const bounce = t > CLICK0 ? 1 - .1 * Math.sin(seg(t, CLICK0, CLICK0 + .35) * Math.PI) : 1;
  $('#dsh').style.transform = `scale(${pr}) translateY(${(1 - bounce) * 140}px)`;
  op($('#dshDot'), seg(t, CLICK0 + .1, CLICK0 + .2));
  ov.desk = { x: (c[0] - cx) * z + 540, y: (c[1] - cy) * z + 960, s: z * 1.25, press: Math.abs(t - CLICK0) < .06, o: 1 - seg(t, CLICK0 + .15, CLICK0 + .3) };
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
const FOLDERS = [
  ['Inbox', true, [['Download this video at max bitrate', '4m', 1], ['Hello', '8d'], ['Can you control my computer?', '8d'], ['Hello', '10d'], ['archify-dsh plugin installed', '11d']], 'I'],
  ['Project A', true, [['TheOne native API check', '2h'], ['Q3 budget draft', '1d'], ['Weekly report', '2d'], ['Refactor auth flow', '3d'], ['Fix flaky CI test', '4d'], ['SQL index help', '5d'], ['Landing page copy', '6d'], ['Bug in CSV export', '6d'], ['Interview questions', '1w'], ['Release notes v0.3', '1w'], ['Untitled', '1w']], 'W'],
  ['Project B', true, [['Habit tracker app', '1w'], ['Cycling route, Sunday', '2w'], ['Balcony herbs', '2w'], ['Rust lifetimes', '2w'], ['Docker won’t start', '3w'], ['Name ideas', '3w'], ['Paper notes: RAG', '3w'], ['Untitled', '3w'], ['Translate this email', '1mo']], 'S'],
  ['Archive', false, [['Kyoto day plan', '2mo'], ['Kyoto day plan (2)', '2mo'], ['Untitled', '2mo'], ['Untitled', '2mo']], 'A'],
  ['Unsorted', true, [['New session', '1mo'], ['Untitled', '1mo'], ['Recipe: tomato & egg', '1mo'], ['Untitled', '2mo'], ['Cat on my keyboard', '2mo'], ['Is 77 BPM slow?', '2mo'], ['Untitled', '2mo'], ['Untitled', '3mo'], ['New session', '3mo'], ['Untitled', '3mo']], 'U'],
];
const ROWS = {};
FOLDERS.forEach(([name, open, ss, pre]) => {
  const f = h('div', 'frow' + (open ? '' : ' cl'), `${ic(open ? 'FolderOpen' : 'FolderClose')}<span>${name}</span>`); lin.appendChild(f);
  if (pre) ROWS['F' + pre] = f;
  const kids = h('div', 'kids'); lin.appendChild(kids); if (pre) ROWS['K' + pre] = kids;
  ss.forEach(([tt, mt, dot], i) => { const r0 = h('div', 'srow', `${dot ? '<span class="gd"></span>' : ''}<span class="tt">${esc(tt)}</span><span class="mt">${mt}</span>`); r0.dataset.title = tt; kids.appendChild(r0); if (pre) ROWS[pre + i] = r0; });
  if (!open) kids.style.display = 'none';
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
const SEQ_IDS = [];
[['U', 10], ['S', 9], ['W', 11], ['I', 5]].forEach(([p0, n]) => { for (let i = n - 1; i >= 0; i--) SEQ_IDS.push(p0 + i); });
const STEP_T = [];
for (let k = 0; k < 6; k++) STEP_T.push(b(2 + k * .5));      // 8ths while the pad plays
for (let k = 0; k < 8; k++) STEP_T.push(b(5 + k * .25));     // 16ths: the silence starts
for (let k = 0; k < 12; k++) STEP_T.push(b(7 + k * .125));   // 32nds: key held down
const STEPS = STEP_T.map((t0, i) => ({ t: t0, id: SEQ_IDS[i + 1] }));
STEPS.forEach((st0, i) => cue(st0.t, 'flap', { g: i < 6 ? 1 : i < 14 ? 1.05 : 1.12 }));
const T_WH0 = b(8.5), T_WH1 = b(9.4);
cue(T_WH0 - .05, 'whoosh', { dur: 1.2 }); cue(T_WH1, 'settle');
cue(b(9.5), 'pad', { dur: D - b(9.5) }); cue(D - 1.6, 'swell', { dur: 1.6 });
cue(D, 'click', { g: 1.1 }); cue(D, 'impact');

const G = {}; // geometry cache
function rowTop(el) { let y = 0, e = el; while (e && e !== lin) { y += e.offsetTop; e = e.offsetParent; } return y; }
function stepAt(t) { let s = null; for (const x of STEPS) if (t >= x.t) s = x; return s; }
function scrollFor(id) { return clamp(rowTop(ROWS[id]) - 300, 0, G.maxScroll()); }
function listScroll(t) {
  if (t >= T_WH0) return lerp(G.sLast, 0, E.ioe(seg(t, T_WH0, T_WH1 - .1)));
  let val = scrollFor(SEQ_IDS[0]), prevId = SEQ_IDS[0];
  for (let i = 0; i < STEPS.length; i++) {
    const st0 = STEPS[i]; if (t < st0.t) break;
    const gap = (STEPS[i + 1] ? STEPS[i + 1].t : T_WH0) - st0.t;
    val = lerp(scrollFor(prevId), scrollFor(st0.id), E.o(seg(t, st0.t, st0.t + Math.min(.16, gap * .9))));
    prevId = st0.id;
  }
  return val;
}
let lastRender = { scroll: 0 };

/* ---------------------------------------------------------- 3D: what is behind the button */
const ONE = { x: 186, y: 208 };
const ONE_HTML = `<span class="osym"></span><span class="ocopy"><span class="otitle"><span class="owm"><span class="othe">The</span><span class="oone">One<span class="odot"></span></span></span><span class="olab">Main chat</span></span><span class="osub">Pick up the conversation</span></span>`;
const lift = h('div', 'lay', `<div class="lf sd" id="lfF"></div><div class="lf sr" id="lfR"></div><div class="lf top" id="lfT"><div class="zin">${ONE_HTML}</div></div>`);
Object.assign(lift.style, { width: '336px', height: '91px', borderRadius: '0' }); w3.appendChild(lift);
const router = h('div', 'lay glass', `<div class="rlab">ROUTER</div><svg class="ring" width="180" height="180" viewBox="0 0 180 180"><circle cx="90" cy="90" r="82" fill="none" stroke="rgba(40,60,110,.16)" stroke-width="1.5"/><circle cx="90" cy="90" r="56" fill="none" stroke="rgba(40,60,110,.28)" stroke-width="1.5" stroke-dasharray="4 7"/><circle cx="90" cy="90" r="9" fill="#ff8a2a"/></svg><div class="rtag" id="rtag"></div>`);
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
const hist = h('div', 'lay glass hist', `<div class="rlab">HISTORY</div>`);
Object.assign(hist.style, { width: '880px', height: '560px' }); w3.appendChild(hist);
{ const r0 = rng(9); for (let i = 0; i < 34; i++) { const l = h('div', 'hl'); l.style.cssText = `left:${40 + (i % 2) * 420}px;top:${70 + Math.floor(i / 2) * 28}px;width:${120 + r0() * 240}px`; hist.appendChild(l); } }
const Z = { lift: 160, router: -250, cards: -560, hist: -880 };

const ov = $('#ov');
const beamSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); beamSvg.id = 'beams'; beamSvg.setAttribute('width', 1080); beamSvg.setAttribute('height', 1920);
beamSvg.innerHTML = '<defs><filter id="bg2" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4"/></filter></defs>';
ov.appendChild(beamSvg);
const BEAMS = [];
function beam(a, bb, hot) { const g = document.createElementNS('http://www.w3.org/2000/svg', 'g'); g.innerHTML = `<line stroke="${hot ? 'rgba(255,140,40,.55)' : 'rgba(110,140,210,.22)'}" stroke-width="8" filter="url(#bg2)"/><line stroke="${hot ? '#ff8a2a' : 'rgba(80,110,180,.5)'}" stroke-width="2"/>`; beamSvg.appendChild(g); const B = { g, a, b: bb }; BEAMS.push(B); return B; }
const B0 = beam([ONE.x, ONE.y + 46, Z.lift], [ONE.x, ONE.y, Z.router], true);
const BC = CARDS.map(c => beam([ONE.x, ONE.y, Z.router], [c.x, c.y, Z.cards]));
const BN = beam([ONE.x, ONE.y, Z.router], [NEWP.x, NEWP.y, Z.cards]);
const orb = h('div', 'orb'); ov.appendChild(orb);
const bub = h('div', 'bub'); ov.appendChild(bub);
const CHIP_T = ['Q3 budget draft', 'Weekly report', 'Refactor auth flow', 'Habit tracker app', 'Paper notes: RAG', 'Rust lifetimes', 'Kyoto day plan', 'Kyoto day plan (2)', 'Trip budget', 'Balcony herbs', 'Recipe: tomato & egg', 'Cat on my keyboard'];
const CL = [{ name: 'PROJECT A', x: ONE.x - 215, y: ONE.y - 215, t: r(13) }, { name: 'PROJECT B', x: ONE.x + 215, y: ONE.y - 215, t: r(14.25) },
  { name: 'TRAVEL', x: ONE.x - 215, y: ONE.y + 35, t: r(15) }, { name: 'HOME', x: ONE.x + 215, y: ONE.y + 35, t: r(15.5) }];
const CHIP_CL = [0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3], SLOT = [5, 0, 9, 3, 11, 7, 1, 10, 4, 8, 2, 6];
const CHIPS = CHIP_T.map((tt, i) => { const r0 = rng(100 + i), sl = SLOT[i]; const el = h('div', 'chip', esc(tt)); ov.appendChild(el);
  return { el, i, x0: ONE.x - 330 + (sl % 4) * 220 + (r0() - .5) * 60, y0: ONE.y - 200 + Math.floor(sl / 4) * 160 + (r0() - .5) * 50, cl: CHIP_CL[i], k: i % 3, ph: r0() * 6 }; });
const CLAB = CL.map(c => { const el = h('div', 'clab', c.name); ov.appendChild(el); return el; });
const motes = []; { const r0 = rng(21); for (let i = 0; i < 40; i++) { const m = h('div'); m.style.cssText = 'position:absolute;left:0;top:0;width:6px;height:6px;border-radius:50%;background:#ffb066;box-shadow:0 0 12px 3px rgba(255,150,60,.55)'; ov.appendChild(m); motes.push({ el: m, x: r0() * 1080, y: r0() * 1920, sp: 20 + r0() * 70, ph: r0() * 6, s: .4 + r0() * 1.1 }); } }

// post-drop cues on the bar's hard hits (r1, r2.25, r3 …)
cue(r(1), 'layer'); cue(r(2.25), 'layer', { g: .9 }); cue(r(3), 'layer', { g: .8 });
cue(r(4), 'type'); cue(r(5), 'route', { n: 'G5' }); cue(r(6.25), 'hit', { n: 'C6' }); cue(r(7), 'route', { n: 'E5', g: .7 });
cue(r(8), 'type'); cue(r(9), 'route', { n: 'A5' }); cue(r(10.25), 'create'); cue(r(11), 'route', { n: 'C6', g: .6 });
cue(r(12), 'rise'); cue(r(13), 'snap'); cue(r(14.25), 'snap'); cue(r(15), 'snap'); cue(r(15.5), 'snap', { g: .8 });
cue(r(16), 'end');

let WM = new DOMMatrix();
function proj(p) { const q = WM.transformPoint(new DOMPoint(p[0], p[1], p[2])); const k = 2200 / (2200 - q.z); return [540 + (q.x - 540) * k, 960 + (q.y - 960) * k, k]; }
const place = (el, x, y, z, w, hh, o, s = 1) => { el.style.transform = `translate3d(${x - w / 2}px,${y - hh / 2}px,${z}px) scale(${s})`; op(el, o); show(el, o > 0.001); };

function camAt(t) {
  // pre-drop: close, three-quarter angle on the list → whoosh up → frontal on The One
  if (t < D) {
    const k = seg(t, T_WH0, T_WH1), e = E.ioe(k);
    const drift = seg(t, b(1.4), T_WH0);
    const pre = { z: lerp(2.5, 2.62, drift), cx: 200, cy: lerp(730, 700, drift), rx: 4, ry: 9, rz: 0, cz: 0 };
    const top = { z: track(t, [[T_WH1, 2.75], [D - .05, 3.15, 'io']]), cx: ONE.x, cy: ONE.y, rx: 0, ry: 0, rz: 0, cz: 0 };
    const o = {}; for (const key in pre) o[key] = lerp(pre[key], top[key], e);
    if (t > T_WH1) Object.assign(o, top);
    return o;
  }
  const a = E.oe(seg(t, D, r(1.6)));
  const c = { z: lerp(3.15, 1.18, a), cx: ONE.x, cy: ONE.y - 40 * a, rx: lerp(0, 56, E.io(seg(t, D, r(1.6)))), ry: 0, rz: lerp(0, -24, E.io(seg(t, D, r(2)))), cz: lerp(0, -420, a) };
  c.rz += -10 * E.ioq(seg(t, r(2), r(12)));
  // shot C: dive to the history layer
  const k = E.io(seg(t, r(11.6), r(12.8)));
  c.cz = lerp(c.cz, Z.hist, k); c.z = lerp(c.z, 1.3, k); c.rx = lerp(c.rx, 22, k); c.rz = lerp(c.rz, 0, k); c.cy = lerp(c.cy, ONE.y + 20, k);
  return c;
}

function sApp(t, ovs) {
  const vis = t >= b(1) && t < r(16.4); show($('#appwrap'), vis); if (!vis) return;
  // window-open from the dock icon
  const aw = $('#appwrap');
  if (t < b(1.7)) {
    const p = E.oe(seg(t, CLICK0 + .02, b(1.55)));
    const ix = (ICON.x - DCAM.x) * DCAM.z + 540, iy = (ICON.y - DCAM.y) * DCAM.z + 960;
    const s = lerp(.06, 1, p);
    aw.style.transform = `translate(${lerp(ix, 540, p) - 540 * s}px,${lerp(iy, 960, p) - 960 * s}px) scale(${s})`;
    op(aw, seg(t, CLICK0, CLICK0 + .12)); aw.style.borderRadius = lerp(200, 0, p) + 'px'; aw.style.overflow = 'hidden';
  } else { aw.style.transform = 'none'; op(aw, 1); aw.style.overflow = ''; }

  const C = camAt(t);
  w3.style.transform = `translate(540px,960px) rotateX(${C.rx}deg) rotateY(${C.ry}deg) rotateZ(${C.rz}deg) scale3d(${C.z},${C.z},${C.z}) translate3d(${-C.cx}px,${-C.cy}px,${-C.cz}px)`;
  WM = new DOMMatrix().translate(540, 960).rotateAxisAngle(1, 0, 0, C.rx).rotateAxisAngle(0, 1, 0, C.ry).rotateAxisAngle(0, 0, 1, C.rz).scale(C.z, C.z, C.z).translate(-C.cx, -C.cy, -C.cz);

  // ---- the search
  const st = stepAt(t);
  const sc = t < D ? listScroll(t) : 0;
  lin.style.transform = `translateY(${-sc}px)`;
  const selId = st ? st.id : SEQ_IDS[0];
  let selTitle = 'TheOne · Main chat';
  for (const k in ROWS) if (ROWS[k].classList.contains('srow')) { const on = k === (t >= T_WH0 ? '__' : selId); ROWS[k].classList.toggle('sel', on); if (on) selTitle = ROWS[k].dataset.title; }
  if (t < T_WH0) setMain(selTitle, st ? STEPS.indexOf(st) : 99); else setMain('TheOne · Main chat', 0);
  // motion blur from camera + list velocity
  const C2 = camAt(t - 1 / 60), vel = Math.hypot((C.cy - C2.cy) * C.z, (C.z - C2.z) * 600) * 60 + Math.abs(sc - (t - 1 / 60 < D ? listScroll(t - 1 / 60) : 0)) * 60 * C.z;
  const bl = t > T_WH0 - .1 && t < T_WH1 + .1 ? Math.min(60, vel / 260) : 0;
  if (bl > .4) { $('#vbg').setAttribute('stdDeviation', `0 ${bl.toFixed(1)}`); win.style.filter = 'url(#vb)'; } else win.style.filter = '';
  // depth of field: the far side of the window softens while we are angled
  $('#main').style.filter = C.ry > 2 ? `blur(${(C.ry / 9 * 2).toFixed(2)}px)` : '';

  // ---- the reveal light
  const g = seg(t, T_WH1 - .1, b(10.4));
  op($('#dimW'), t < D ? .82 * E.io(g) : lerp(.82, 0, seg(t, D, r(1))));
  op($('#rays'), t < D ? .9 * E.io(seg(t, b(9.9), b(11.8))) : 1 - seg(t, D, D + .25));
  $('#rays').style.transform = `rotate(${(t - b(8.8)) * 6}deg)`;
  op($('#halo'), t < D ? E.io(seg(t, T_WH1, b(11))) * (.8 + .2 * Math.sin(t * 2.2)) : 1 - seg(t, D, D + .3));
  const one = $('#oneBtn'), gl = t > T_WH1 ? track(t, [[T_WH1, .2], [b(11.4), .65], [D, 1]]) + .06 * Math.sin(t * 3.4) : 0;
  one.style.boxShadow = gl ? `0 0 ${30 + 90 * gl}px ${4 + 26 * gl}px rgba(255,${140 + 40 * gl | 0},60,${.2 + .45 * gl}),0 0 ${10 + 20 * gl}px ${1 + 5 * gl}px rgba(255,236,210,${.35 * gl})` : '';
  one.style.borderColor = gl > .3 ? '#f5b680' : '#eed3bb';
  one.style.transform = `scale(${(t > b(12.2) && t < D ? 1.02 : 1) * (t > D - .09 && t < D + .05 ? .975 : 1)})`;
  one.style.visibility = t >= D ? 'hidden' : 'visible';
  const mv = t > T_WH1 && t < D + .3 ? seg(t, T_WH1, b(10.2)) * (1 - seg(t, D, D + .3)) : 0;
  motes.forEach(M => { if (!mv) { op(M.el, 0); return; } const y = ((M.y - (t - T_WH1) * M.sp) % 1920 + 1920) % 1920; M.el.style.transform = `translate(${M.x + 14 * Math.sin(t + M.ph)}px,${y}px) scale(${M.s})`; op(M.el, mv * (.35 + .65 * Math.abs(Math.sin(t * 1.7 + M.ph)))); });

  // ---- cursor (inside the window, so it shares the camera)
  let cx = 0, cy = 0, hand = false, press = false, co = 0;
  if (t >= b(9.8) && t < D + .1) {
    co = seg(t, b(9.8), b(10.2)) * (1 - seg(t, D + .02, D + .1));
    cx = track(t, [[b(9.8), 262], [b(11), 248, 'io'], [b(12.2), 214, 'io']]);
    cy = track(t, [[b(9.8), 430], [b(11), 300, 'io'], [b(12.2), 222, 'io']]);
    hand = t > b(12.1); press = t > D - .07 && t < D + .06;
  }
  show(cur, co > 0); op(cur, co);
  const shape = hand ? 'h' : 'a'; if (cur.dataset.s !== shape) { cur.innerHTML = hand ? HAND : ARROW; cur.dataset.s = shape; }
  cur.style.transform = `translate(${cx - (hand ? 9 : 3)}px,${cy - 3}px) scale(${press ? .86 : 1})`;

  // ---- behind the button
  const post = t >= D;
  op(win, post ? lerp(1, .07, E.io(seg(t, D, r(1.4)))) * (1 - seg(t, r(11.6), r(12.4))) : 1);
  const dimC = 1 - E.io(seg(t, r(11.6), r(12.3)));
  place(lift, ONE.x, ONE.y, post ? lerp(0, Z.lift, E.oe(seg(t, D, r(1.2)))) : 0, 336, 91, post ? dimC : 0, post ? lerp(1, 1.5, E.oe(seg(t, D, r(1.4)))) : 1);
  const TH = 28 * E.oe(seg(t, D, r(1)));
  $('#lfT').style.transform = `translateZ(${TH}px)`;
  $('#lfT').style.boxShadow = `0 0 ${50 + 30 * pulse(t)}px ${8 + 8 * pulse(t)}px rgba(255,140,40,${.35 + .2 * pulse(t)})`;
  for (const [id, css] of [['lfF', `left:0;top:91px;width:336px;height:${TH}px;transform-origin:50% 0;transform:rotateX(90deg)`], ['lfR', `left:336px;top:0;width:${TH}px;height:91px;transform-origin:0 50%;transform:rotateY(-90deg)`]]) $('#' + id).style.cssText = css;
  const app = (t0, z0, z1) => [E.oe(seg(t, t0 - .08, t0 + .4)), lerp(z0, z1, E.oe(seg(t, t0 - .08, t0 + .4)))];
  const [ra, rz0] = app(r(1), 0, Z.router); place(router, ONE.x, ONE.y, rz0, 520, 300, post ? ra * dimC : 0);
  CARDS.forEach((c, i) => { const [ca, cz0] = app(r(2.25) + (i % 3) * .03 + Math.floor(i / 3) * .03, Z.router, Z.cards); place(c.el, c.x, c.y, cz0, 230, 136, post ? ca * dimC : 0); });
  const [ha, hz0] = app(r(3), Z.cards, Z.hist); place(hist, ONE.x, ONE.y, hz0, 880, 560, post ? ha : 0);
  const nk = seg(t, r(10.25) - .1, r(10.25) + .35); place(NEWC, NEWP.x, NEWP.y, Z.cards, 230, 136, post ? Math.min(1, nk * 3) * dimC : 0, lerp(.6, 1, E.ob(nk)));
  // card highlight
  const hot0 = t > r(6.25) && t < r(8), hot1 = t > r(10.25) && t < r(12);
  CARDS[0].el.style.borderColor = hot0 ? '#ffb070' : ''; CARDS[0].el.style.boxShadow = hot0 ? '0 0 60px 8px rgba(255,140,40,.4)' : '';
  NEWC.style.borderColor = hot1 ? '#ffb070' : ''; NEWC.style.boxShadow = hot1 ? '0 0 60px 8px rgba(255,140,40,.4)' : '';
  // router tag
  const tag = t > r(9) ? 'CREATE' : t > r(5) ? 'SWAP' : ''; const rt = $('#rtag'); rt.textContent = tag;
  op(rt, tag ? (t > r(9) ? seg(t, r(9), r(9) + .1) : seg(t, r(5), r(5) + .1)) * (1 - seg(t, r(11.5), r(12))) : 0);
  router.style.boxShadow = (Math.abs(t - r(5)) < .35 || Math.abs(t - r(9)) < .35) ? '0 0 80px 10px rgba(255,150,60,.35)' : '';

  // overlay: beams, orb, bubble, chips
  show(ov, true);
  const bo = post ? seg(t, r(3.2), r(4)) * (1 - seg(t, r(11.6), r(12.2))) : 0;
  const setB = (B, o) => { const p = proj(B.a), q = proj(B.b); B.g.querySelectorAll('line').forEach(l => { l.setAttribute('x1', p[0]); l.setAttribute('y1', p[1]); l.setAttribute('x2', q[0]); l.setAttribute('y2', q[1]); }); B.g.style.opacity = o; };
  setB(B0, bo); BC.forEach((B, i) => setB(B, bo * (i === 0 && hot0 ? 1 : .35))); setB(BN, post ? bo * Math.min(1, nk * 2) * (hot1 ? 1 : .35) : 0);
  const path = [];
  const P_ONE = [ONE.x, ONE.y, Z.lift], P_R = [ONE.x, ONE.y, Z.router], P_C0 = [CARDS[0].x, CARDS[0].y, Z.cards], P_N = [NEWP.x, NEWP.y, Z.cards];
  const flights = [[r(4.4), r(5), P_ONE, P_R], [r(5.15), r(6.25), P_R, P_C0], [r(6.4), r(7), P_C0, P_ONE], [r(8.4), r(9), P_ONE, P_R], [r(9.15), r(10.25), P_R, P_N]];
  let op0 = 0, pp = null;
  for (const [a, bb, p, q] of flights) if (t >= a && t <= bb + .05) { const k = E.io(seg(t, a, bb)); pp = proj([lerp(p[0], q[0], k), lerp(p[1], q[1], k), lerp(p[2], q[2], k)]); op0 = 1; }
  if (pp) { orb.style.transform = `translate(${pp[0]}px,${pp[1]}px)`; } op(orb, op0);
  const bubs = [[r(4), r(5.2), 'Kyoto, day 3?', 0], [r(7), r(8), 'Arashiyama at 9 am.', 1], [r(8), r(9.2), 'New topic: a cat feeder', 0]];
  let bb0 = null; for (const x of bubs) if (t >= x[0] && t < x[1]) bb0 = x;
  if (bb0) { const p = proj([ONE.x, ONE.y - 30, Z.lift + 10]); bub.textContent = bb0[2]; bub.className = 'bub' + (bb0[3] ? ' r' : ''); const k = E.ob(seg(t, bb0[0], bb0[0] + .25)); bub.style.transform = `translate(${p[0]}px,${p[1]}px) translate(-50%,-160%) scale(${lerp(.7, 1, k)})`; op(bub, seg(t, bb0[0], bb0[0] + .08) * (1 - seg(t, bb0[1] - .12, bb0[1]))); } else op(bub, 0);
  CHIPS.forEach(c => {
    if (t <= r(11.6)) { op(c.el, 0); return; }
    const Cc = CL[c.cl], k = E.oe(seg(t, Cc.t - .1, Cc.t + .3));
    // chaos: fly in from outside, then swirl and tumble over each other at different depths
    const tin = E.o(seg(t, r(11.6) + c.i * .03, r(12.3) + c.i * .03));
    const th = c.ph + (t - r(11.6)) * (1.1 + (c.i % 4) * .35) * (c.i % 2 ? 1 : -1);
    const rad = lerp(900, 150 + (c.i % 5) * 45, tin) + 30 * Math.sin(t * 3 + c.ph);
    const fx = ONE.x + Math.cos(th) * rad, fy = ONE.y - 60 + Math.sin(th) * rad * .75;
    const fz = Z.hist + 60 + 140 * Math.sin(t * 1.7 + c.ph * 2);
    const tx = Cc.x, ty = Cc.y + 34 + c.k * 52;
    const p = proj([lerp(fx, tx, k), lerp(fy, ty, k), lerp(fz, Z.hist + 8, k)]);
    const rot = (1 - k) * (28 * Math.sin(t * 2.3 + c.ph * 3) + (c.i % 2 ? 14 : -14));
    c.el.style.transform = `translate(${p[0]}px,${p[1]}px) translate(-50%,-50%) rotate(${rot}deg) scale(${.92 * p[2]})`;
    c.el.style.zIndex = k > .5 ? 2 : 1;
    op(c.el, seg(t, r(11.6), r(11.9)) * (1 - seg(t, r(15.8), r(16.2))));
  });
  CL.forEach((c, i) => { const p = proj([c.x, c.y - 14, Z.hist + 8]); CLAB[i].style.transform = `translate(${p[0]}px,${p[1]}px) translate(-50%,-50%)`; op(CLAB[i], seg(t, c.t, c.t + .15) * (1 - seg(t, r(15.8), r(16.2)))); });
}
function pulse(t) { if (t < D) return 0; const x = ((t - D) / BEAT) % 4; let p = 0; for (const a of [0, 1, 2.25, 3]) { const d = x - a; if (d >= 0) p = Math.max(p, Math.exp(-d * 5)); } return p; }

/* ---------------------------------------------------------- end card */
const endEl = $('#end');
endEl.innerHTML = `<div class="ewm" id="ewm"><span class="t">The</span><span class="o">One<span class="d"></span></span></div>
  <div class="etag" id="etag">One chat. Every context.</div>
  <div class="eurl" id="eurl">github.com/YunongDai2005/dsh-theone</div>
  <div class="edisc" id="edisc">Community plugin for DSH · unofficial</div>`;
function sEnd(t) {
  const vis = t >= r(15.9); show(endEl, vis); if (!vis) return;
  op(endEl, seg(t, r(15.9), r(16.05)));
  const k = seg(t, r(16), r(16) + .5);
  $('#ewm').style.transform = `scale(${lerp(1.12, 1, E.oe(k)) * (1 + .015 * pulse(t))})`; op($('#ewm'), seg(t, r(16), r(16) + .12));
  const up = (id, a) => { const el = $(id), p = seg(t, a, a + .4); op(el, p); el.style.transform = `translateY(${(1 - E.o(p)) * 24}px)`; };
  up('#etag', r(17)); up('#eurl', r(18.25)); up('#edisc', r(18.6));
}

/* ---------------------------------------------------------- global FX */
const grain = $('#grain'), gctx = grain.getContext('2d');
{ const img = gctx.createImageData(398, 608), r0 = rng(77); for (let i = 0; i < img.data.length; i += 4) { const v = r0() * 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; } gctx.putImageData(img, 0, 0);  }
function sFX(t) {
  const f = Math.max(t >= D ? 1 - E.o(seg(t, D, D + .55)) : 0, t >= r(16) ? .5 * (1 - E.o(seg(t, r(16), r(16) + .4))) : 0);
  op($('#flash'), f);
  const fr = Math.floor(t * 30), r0 = rng(fr + 1);
  grain.style.transform = `translate(${Math.floor(r0() * 256)}px,${Math.floor(r0() * 256)}px) scale(2.6)`; grain.style.transformOrigin = '0 0';
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
  if (t >= T_WH0 && G.sLast == null) G.sLast = listScroll(T_WH0 - 1e-3);
  if (G.sLast == null) G.sLast = 0;
  sApp(t, ovs); sEnd(t); sFX(t);
}
window.render = render;
window.warm = async () => {
  const wasDisp = $('#appwrap').style.display; $('#appwrap').style.display = '';
  await document.fonts.ready;
  for (let t = 0; t < TOTAL; t += .3) render(t);
  await document.fonts.ready;
  G.sLast = null; render(T_WH0 - .01); G.sLast = listScroll(T_WH0 - 1e-3);
  render(0); await new Promise(r0 => setTimeout(r0, 300));
  return CUES.length;
};
if (!navigator.webdriver) window.warm().then(() => { const t0 = performance.now(); const loop = () => { render(((performance.now() - t0) / 1000) % TOTAL); requestAnimationFrame(loop); }; loop(); });

'use strict';
/* TheOne promo — every frame is a pure function of t (seconds). */
const $ = s => document.querySelector(s);
const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const clamp = (x, a = 0, b = 1) => x < a ? a : x > b ? b : x;
const lerp = (a, b, p) => a + (b - a) * p;
const seg = (t, a, b) => clamp((t - a) / (b - a));
const E = {
  l: x => x, i: x => x * x * x, o: x => 1 - Math.pow(1 - x, 3),
  io: x => x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2,
  ob: x => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); },
  oe: x => x >= 1 ? 1 : 1 - Math.pow(2, -10 * x), ie: x => x <= 0 ? 0 : Math.pow(2, 10 * x - 10),
  ioe: x => x <= 0 ? 0 : x >= 1 ? 1 : x < .5 ? Math.pow(2, 20 * x - 10) / 2 : (2 - Math.pow(2, -20 * x + 10)) / 2,
  iq: x => x * x, oq: x => 1 - (1 - x) * (1 - x), ioq: x => x < .5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2,
};
function track(t, keys) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1, e] = keys[i];
    if (t <= t1) {
      const [t0, v0] = keys[i - 1];
      const f = (E[e || 'io'])(t1 === t0 ? 1 : (t - t0) / (t1 - t0));
      return Array.isArray(v0) ? v0.map((a, j) => lerp(a, v1[j], f)) : lerp(v0, v1, f);
    }
  }
  return keys[keys.length - 1][1];
}
function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const show = (el, v) => { const d = v ? '' : 'none'; if (el.style.display !== d) el.style.display = d; };
const op = (el, v) => { el.style.opacity = v; };
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

const BEAT = 60 / 77, D = 24.935, B = n => D + n * BEAT, TOTAL = 58.2;
const CUES = []; const cue = (t, type, o = {}) => CUES.push({ t: +t.toFixed(4), type, ...o });
window.CUES = CUES; window.TOTAL = TOTAL;

const ICON = {
  panel: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/></svg>',
  plusc: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>',
  grid: '<svg class="ico" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/></svg>',
  plug: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 3v4M15 3v4M6 7h12v3a6 6 0 0 1-12 0zM12 16v5"/></svg>',
  search: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>',
  sliders: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>',
  fplus: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 10v6M9 13h6"/></svg>',
  folder: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  folderOpen: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 17V7a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v1"/><path d="M3 17l3-7h16l-3 7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  gear: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/></svg>',
};
const WHALE = '<svg viewBox="0 0 64 44"><path d="M61 9c-3.5 0-5.8 2.2-6.8 4.6C50 8.6 43 5.5 34 5.5 18.5 5.5 5 14.5 5 26.5 5 34.5 12 40 24 40c12.5 0 22.5-5.5 28.6-14.6 1.4 2.4 4.4 4.1 7.6 4.1-2.2-2.4-3.2-5.4-3.2-7.8 0-3.6 2-6.9 4-9.2z" fill="currentColor"/><circle cx="19" cy="22" r="2.8" fill="#fff"/></svg>';
const ONE_INNER = '<span class="osym"></span><span class="ocopy"><span class="otitle"><span class="owm"><span class="othe">The</span><span class="oone">One<span class="odot"></span></span></span><span class="olab">主聊天</span></span><span class="osub">从这里继续聊</span></span>';
const ARROW = '<svg width="50" height="74" viewBox="0 0 24 35.5"><path d="M2 2 L2 28 L8.3 21.8 L12.7 32 L16.9 30.2 L12.5 20.2 L21.2 20.2 Z" fill="#fff" stroke="#111" stroke-width="1.7" stroke-linejoin="round"/></svg>';
const HAND = '<svg width="62" height="70" viewBox="0 0 32 36"><path d="M11 17V4.5a3 3 0 0 1 6 0V14a3 3 0 0 1 5.2 1.2 3 3 0 0 1 5 1.6 3 3 0 0 1 4 2.2V26c0 5.2-4 9-9 9h-5c-3.6 0-5.6-1.6-7.6-4.6L4.4 23a2.7 2.7 0 0 1 4.2-3.3z" fill="#fff" stroke="#111" stroke-width="1.7" stroke-linejoin="round"/></svg>';

/* =========================================================== DESKTOP */
const deskWorld = $('#deskWorld');
deskWorld.innerHTML = `
  <div class="sticky"><div class="t">TODO</div>· 找到上周那个方案<br>· 找到上周那个方案！！<br>· <s>摸鱼</s> 真的要找到</div>
  <div class="widget"><div class="d">今天 · 10:00</div><div class="e">方案评审 😰</div><div class="f">还有 18 分钟</div></div>
  <div class="dock"></div>
  <div class="appicon" style="left:140px;background:linear-gradient(160deg,#7ad1ff,#2f8ef0)">📁</div>
  <div class="appicon" style="left:305px;background:linear-gradient(160deg,#fff6c8,#ffd84a)">🗒️</div>
  <div class="appicon" style="left:470px;background:linear-gradient(160deg,#ff8fa7,#ff3d6b)">🎵</div>
  <div class="appicon" id="dshIcon" style="left:635px">${WHALE}</div>
  <div class="appicon" style="left:800px;background:linear-gradient(160deg,#9ef0c0,#25b36b)">🌐</div>
  <div class="tooltip" id="dshTip">DeepSeek Harness</div>`;
const dshIcon = $('#dshIcon'), dshTip = $('#dshTip');
const ICON_C = { x: 705, y: 1565 };
function cursorDesk(t) {
  const u = E.io(seg(t, 0.12, 1.28));
  const P = [[880, 1180], [1010, 1430], [560, 1400], [ICON_C.x - 4, ICON_C.y + 8]];
  const m = 1 - u;
  return { x: m*m*m*P[0][0] + 3*m*m*u*P[1][0] + 3*m*u*u*P[2][0] + u*u*u*P[3][0],
           y: m*m*m*P[0][1] + 3*m*m*u*P[1][1] + 3*m*u*u*P[2][1] + u*u*u*P[3][1] };
}
const CLICK1 = 1.42;
cue(CLICK1, 'click'); cue(1.56, 'swoosh', { g: .55 });
{ // counter ticks: like a slot machine slowing down
  let last = -1;
  for (let t = 0.15; t < 1.32; t += 1 / 60) { const v = Math.floor(countAt(t) / 60); if (v !== last) { last = v; cue(t, 'tick', { g: .35 }); } }
}
function countAt(t) { return Math.round(1284 * E.oe(seg(t, 0.15, 1.35))); }

const CAM = { x: 540, y: 960, z: 1 };
function sDesk(t, CUR) {
  const vis = t < 2.5; show($('#desk'), vis); if (!vis) return;
  const cp = cursorDesk(t), cd = cursorDesk(Math.max(0, t - 0.22));
  const z = track(t, [[0, 1.8], [1.5, 1.8], [2.3, 1.0, 'io']]);
  const back = E.io(seg(t, 1.5, 2.3));
  let cx = lerp(cd.x, 540, back), cy = lerp(cd.y, 960, back);
  cx = clamp(cx, 540 / z, 1080 - 540 / z); cy = clamp(cy, 960 / z, 1920 - 960 / z);
  CAM.x = cx; CAM.y = cy; CAM.z = z;
  deskWorld.style.transform = `translate(540px,960px) scale(${z}) translate(${-cx}px,${-cy}px)`;
  deskWorld.style.filter = `brightness(${1 - .35 * seg(t, 1.6, 2.3)})`;
  // icon hover / press bounce
  const hov = seg(t, 1.0, 1.15);
  const pr = t > CLICK1 - .05 && t < CLICK1 + .12 ? .9 : 1;
  const bounce = t > CLICK1 + .1 ? 1 + .12 * Math.sin(seg(t, CLICK1 + .1, CLICK1 + .6) * Math.PI * 2) * (1 - seg(t, CLICK1 + .1, CLICK1 + .6)) : 1;
  dshIcon.style.transform = `scale(${(1 + .08 * hov) * pr * bounce})`;
  op(dshTip, hov * (1 - seg(t, 1.45, 1.6)));
  const sx = (cp.x - cx) * z + 540, sy = (cp.y - cy) * z + 960;
  Object.assign(CUR, { vis: true, x: sx, y: sy, s: 1.0 * z, o: 1 - seg(t, 1.75, 2.0), press: Math.abs(t - CLICK1) < .06, rip: seg(t, CLICK1, CLICK1 + .45) });
}

/* =========================================================== SIDEBAR */
const sbInner = $('#sbInner');
sbInner.innerHTML = `
  <div class="hdr"><span class="wh">${WHALE}</span><span class="ds">deepseek</span><span class="hb">HARNESS</span><span class="sp"></span><span class="pi">${ICON.panel}</span></div>
  <div class="newbtn">${ICON.plusc}<span>新会话</span></div>
  <div class="one" id="oneBtn">${ONE_INNER}</div>
  <div class="row nav">${ICON.grid}<span>话题工作区</span></div>
  <div class="row nav">${ICON.plug}<span>插件</span></div>
  <div class="row sec"><span>工作区</span><span class="ics">${ICON.search}${ICON.sliders}${ICON.fplus}</span></div>
  <div id="dimIn"></div><div id="halo"></div><div id="rays"></div>`;
function folder(name, open, sessions, id) {
  const f = h('div', 'row folder', `${open ? ICON.folderOpen : ICON.folder}<span>${esc(name)}</span>`);
  if (id) f.id = id;
  sbInner.appendChild(f);
  const kids = h('div', 'kids'); if (id) kids.id = id + 'Kids';
  sessions.forEach((s, i) => { const r = h('div', 'row sess', esc(s)); if (id) r.id = id + 'K' + i; kids.appendChild(r); });
  sbInner.appendChild(kids);
  return { f, kids };
}
folder('默认工作区', true, ['新会话', '帮我写个周报', '周报改短一点', '周报再改短一点', '解释一下这段正则', '代码报错求助', '新会话 (2)', '给猫取名字', '下雨天适合干嘛', '早餐吃什么', '旅行清单', '简历润色', '简历再润色一下', '向量数据库是啥', '新会话 (3)', 'debug 第 47 轮', '阳台种什么好', '周末去哪', '帮我起个标题', '新会话 (4)', '会议纪要', '年终总结', '预算表格', '番茄炒蛋做法', '新会话 (5)', '猫一直踩键盘', '今晚吃什么', '77 BPM 快吗', '新会话 (6)', '那个方案呢']);
folder('学习笔记', true, ['论文文献综述', '统计学复习', '向量检索入门', 'SQLite 怎么建索引', 'TypeScript 泛型', '正则从入门到放弃', '读书笔记：三体', '英语邮件润色', 'Rust 所有权', '画个流程图', 'Docker 报错', 'Git 合并冲突', '新会话 (7)', '如何读论文', '什么是 RAG']);
folder('生活琐事', true, ['骑行路线规划', '阳台香草种植', '习惯追踪 App', '搬家清单', '猫粮怎么选', '健身计划', '周末露营', '生日礼物灵感', '咖啡怎么冲', '新会话 (8)', '旅行预算']);
const big = folder('那个大项目', false, ['方案讨论 v3', '方案讨论 v3（最终版）', '方案讨论 v3（真·最终版）'], 'bigF');
folder('旧项目', true, ['方案讨论 v1', '方案讨论 v2', '需求评审', '接口文档', '上线复盘', '新会话 (9)', '新会话 (10)', '帮我想个名字']);
sbInner.appendChild(h('div', 'row nav', `${ICON.gear}<span>设置</span>`));
const oneBtn = $('#oneBtn'), dimIn = $('#dimIn'), rays = $('#rays'), halo = $('#halo');
const bigKids = $('#bigFKids'); bigKids.style.height = '0px';
const sbGeom = {};
function measure() {
  const appEl = $('#app'), prevD = appEl.style.display; appEl.style.display = '';
  bigKids.style.height = '0px';
  sbGeom.total = sbInner.offsetHeight;
  sbGeom.bottom = sbGeom.total - 1920;
  sbGeom.folderTop = big.f.offsetTop;
  sbGeom.s2 = sbGeom.folderTop - 640;
  sbGeom.oneTop = oneBtn.offsetTop; sbGeom.oneH = oneBtn.offsetHeight;
  const c = sbGeom.oneTop + sbGeom.oneH / 2;
  rays.style.left = (540 - 56 - 1300) + 'px'; rays.style.top = (c - 1300) + 'px';
  halo.style.left = (540 - 56 - 750) + 'px'; halo.style.top = (c - 450) + 'px';
  appEl.style.display = prevD;
}
// motes
const motesEl = $('#motes'); const MOTES = [];
{ const r = rng(7); for (let i = 0; i < 46; i++) { const m = h('div', 'mote'); motesEl.appendChild(m); MOTES.push({ el: m, x: 60 + r() * 960, y: 300 + r() * 1700, sp: 40 + r() * 120, ph: r() * 6.28, sz: .5 + r() * 1.3 }); } }
// speed lines
const speedEl = $('#speed'); const SPEED = [];
{ const r = rng(11); for (let i = 0; i < 34; i++) { const l = h('div', 'sl'); speedEl.appendChild(l); SPEED.push({ el: l, x: 30 + r() * 1020, len: 260 + r() * 600, off: r() * 2400, w: 2 + r() * 5 }); } }

/* timings for the sidebar act */
const T_BOARD_IN = 4.45, T_BOARD_OUT = 9.55, T_FCLICK = 10.12, T_VCLICK = 11.5, T_CHAT = 11.62;
const T_WHOOSH = 18.70, T_ARRIVE = 19.86;
cue(T_FCLICK, 'click', { g: .8 }); cue(T_FCLICK + .06, 'pop', { g: .25 });
cue(T_VCLICK, 'click', { g: .8 }); cue(T_CHAT, 'swoosh', { g: .5 });
cue(T_WHOOSH - .02, 'whoosh'); cue(T_ARRIVE + .02, 'thump', { g: .6 });
cue(19.95, 'choir', { dur: D - 19.95 }); cue(D - 1.9, 'riser', { dur: 1.9 });
cue(21.55, 'sparkle', { g: .5 }); cue(23.0, 'sparkle', { g: .45 });
cue(24.2, 'tick', { g: .4 }); cue(D, 'click', { g: 1.1 }); cue(D, 'boom');

function scrollAt(t) {
  if (t < 4.6) return track(t, [[2.0, sbGeom.bottom], [2.6, sbGeom.bottom], [4.6, sbGeom.bottom - 760, 'iq']]);
  if (t < 7) return sbGeom.bottom - 760;
  if (t < T_WHOOSH) return sbGeom.s2;
  return track(t, [[T_WHOOSH, sbGeom.s2], [T_ARRIVE, -46, 'ioe'], [T_ARRIVE + .35, 0, 'io']]);
}
function sApp(t, CUR) {
  const vis = t >= 1.5 && t < D + .05; show($('#app'), vis); if (!vis) return;
  const app = $('#app');
  // window opening from the dock icon
  if (t < 2.35) {
    const p = E.o(seg(t, 1.55, 2.3));
    const icx = (ICON_C.x - CAM.x) * CAM.z + 540, icy = (ICON_C.y - CAM.y) * CAM.z + 960;
    const s0 = 140 * CAM.z / 1080, s = lerp(s0, 1, p);
    const cx = lerp(icx, 540, p), cy = lerp(icy, 960, p);
    app.style.transform = `translate(${cx - 540 * s}px,${cy - 960 * s}px) scale(${s})`;
    app.style.borderRadius = lerp(260, 0, p) + 'px';
    op(app, seg(t, 1.55, 1.7));
  } else if (t > 19.9) {
    const z = track(t, [[20.0, 1], [D - .05, 1.1, 'io'], [D, 1.13, 'i']]);
    const bx = 540, by = sbGeom.oneTop + sbGeom.oneH / 2 - scrollAt(t);
    app.style.transform = `translate(${bx}px,${by}px) scale(${z}) translate(${-bx}px,${-by}px)`;
    app.style.borderRadius = '0px'; op(app, 1);
  } else { app.style.transform = 'none'; app.style.borderRadius = '0px'; op(app, 1); }

  // scroll & motion blur
  const sc = scrollAt(t);
  sbInner.style.transform = `translateY(${-sc}px)`;
  const v = (sc - scrollAt(t - 1 / 60)) * 60;
  const bl = Math.min(80, Math.abs(v) / 180);
  const sb = $('#sb');
  if (bl > .5) { $('#vbg').setAttribute('stdDeviation', `0 ${bl.toFixed(1)}`); sb.style.filter = 'url(#vb)'; } else sb.style.filter = 'none';
  const sp = clamp(Math.abs(v) / 7000);
  show(speedEl, sp > .01);
  if (sp > .01) SPEED.forEach(L => { L.el.style.cssText = `left:${L.x}px;width:${L.w}px;height:${L.len}px;top:${((L.off + sc * -0.9) % 2600 + 2600) % 2600 - 400}px;opacity:${sp}`; });

  // folder expansion
  const ex = E.o(seg(t, T_FCLICK + .05, T_FCLICK + .45));
  bigKids.style.height = (312 * ex) + 'px';
  if (ex > 0 && !big.f.dataset.open) { big.f.dataset.open = 1; big.f.firstElementChild.outerHTML = ICON.folderOpen; }
  if (ex === 0 && big.f.dataset.open) { delete big.f.dataset.open; big.f.firstElementChild.outerHTML = ICON.folder; }
  big.f.classList.toggle('hover', t > 9.95 && t < T_FCLICK + .4);
  $('#bigFK0').classList.toggle('hover', t > 11.25 && t < T_VCLICK);
  $('#bigFK0').classList.toggle('sel', t >= T_VCLICK && t < T_WHOOSH);

  // board
  sBoard(t);
  // chat
  sChat(t, CUR);

  // cursor in sidebar act
  const fy = 640 + 52, vy = 640 + 104 + 52;
  if (t >= 9.6 && t < T_CHAT + .3) {
    const x = track(t, [[9.6, 980], [10.05, 330, 'io'], [10.6, 330], [11.35, 390, 'io']]);
    const y = track(t, [[9.6, 1560], [10.05, fy + 6, 'io'], [10.6, fy + 6], [11.35, vy + 6, 'io']]);
    const hand = (t > 9.95 && t < T_FCLICK + .3) || (t > 11.2);
    const pc = t < 11 ? T_FCLICK : T_VCLICK;
    Object.assign(CUR, { vis: true, x, y, s: 1.25, o: seg(t, 9.6, 9.8) * (1 - seg(t, T_CHAT + .1, T_CHAT + .3)), hand, press: Math.abs(t - pc) < .06, rip: seg(t, pc, pc + .45) });
  }
  // whoosh + holy glow act
  const g = seg(t, T_ARRIVE, 21.0);
  op(dimIn, .84 * E.io(g));
  op(rays, .85 * E.io(seg(t, 20.3, 22.6)) + .1 * Math.sin(t * 3.1) * seg(t, 22.6, 23));
  rays.style.transform = `rotate(${(t - 19.9) * 7}deg)`;
  op(halo, E.io(seg(t, 20.0, 22.0)) * (.75 + .25 * Math.sin(t * 2.4)));
  const gl = track(t, [[19.9, .1], [22, .55], [24.4, 1]]) + .08 * Math.sin(t * 4.2);
  const hov = seg(t, 24.15, 24.3), press = t > 24.82 ? 1 : 0;
  oneBtn.style.boxShadow = t < 19.9 ? '0 0 22px 4px rgba(255,107,0,.14)' :
    `0 0 ${50 + 160 * gl}px ${8 + 50 * gl}px rgba(255,${130 + 50 * gl | 0},40,${.18 + .5 * gl}), 0 0 ${20 + 40 * gl}px ${2 + 10 * gl}px rgba(255,230,190,${.3 * gl})`;
  oneBtn.style.transform = `scale(${(1 + .04 * hov) * (press ? .965 : 1)})`;
  oneBtn.style.borderColor = gl > .3 && t > 19.9 ? '#f3b37a' : '#eed3bb';
  const mv = seg(t, 20.0, 21.2) * (1 - seg(t, D - .02, D + .05));
  show(motesEl, mv > 0);
  if (mv > 0) MOTES.forEach(M => {
    const y = ((M.y - (t - 19.9) * M.sp) % 1700 + 1700) % 1700 + 150;
    M.el.style.cssText = `left:${M.x + 18 * Math.sin(t * 1.3 + M.ph)}px;top:${y}px;transform:scale(${M.sz});opacity:${mv * (.4 + .6 * Math.abs(Math.sin(t * 2 + M.ph)))}`;
  });
  if (t >= 17.4 && t < D + .02) {
    const by = sbGeom.oneTop + sbGeom.oneH / 2 - scrollAt(t);
    let x, y, rot = 0, hand = false;
    if (t < T_WHOOSH) { // in chat: droop then look up
      x = 840; y = 1430 + 30 * E.io(seg(t, 17.5, 17.9)) - 120 * E.ob(seg(t, 18.32, 18.6));
      rot = 28 * E.io(seg(t, 17.5, 17.9)) * (1 - seg(t, 18.25, 18.45)) - 16 * seg(t, 18.3, 18.5);
    } else if (t < 20.6) { x = lerp(840, 600, E.io(seg(t, T_WHOOSH, 19.4))); y = lerp(1310, 1340, seg(t, 19.4, 20.6)); rot = -16 * (1 - seg(t, 19.6, 20.2)); }
    else {
      x = track(t, [[20.6, 600], [22.4, 700, 'io'], [23.0, 690], [24.15, 600, 'io']]);
      y = track(t, [[20.6, 1340], [22.4, 1120, 'io'], [23.0, 1130], [24.15, by + 28, 'io']]);
      hand = t > 24.1;
    }
    const zz = t > 19.9 ? track(t, [[20.0, 1], [D - .05, 1.1, 'io']]) : 1;
    const stretch = t > T_WHOOSH && t < T_ARRIVE ? 1 + .5 * Math.sin(seg(t, T_WHOOSH, T_ARRIVE) * Math.PI) : 1;
    Object.assign(CUR, { vis: true, x: t > 19.9 ? 540 + (x - 540) * zz : x, y: t > 19.9 ? by + (y - by) * zz : y, s: 1.25 * (t > 19.9 ? zz : 1), o: 1, rot, hand, sy: stretch,
      press: t > 24.82 && t < D + .05, rip: seg(t, D, D + .4), sweat: t > 17.55 && t < 18.35 ? seg(t, 17.55, 18.35) : 0 });
  }
}

/* =========================================================== SPLIT-FLAP BOARD */
const boardEl = $('#board');
boardEl.innerHTML = '<div class="bhead"><div class="a">历史会话<small>SESSIONS</small></div><div class="b">状态 STATUS</div></div>';
const TW = 66, TG = 5, BX = 101, BY = 420, PITCH = 104, NT = 12, FD = 0.072;
const POOL = Array.from('的一是在不了有和人这中大为上个我以要他时来用们生到作地于出就分对成会可主发年动同工也能下过子说产种面而方后多定行学法所经十三之进着等部度家电力里如水化高自二理起小物现实加量都两体制机当使点从业本去把性好应开它合还因由其些然前外天四日那事平形相全表间样与关各重新线内数正心反你明看原又么利比或但质气第向道命此变条只没结解问意建月公无系很情者最立代想已通并提直题程展五果料象员革位入常文总次品式活设及管特件长求老头基资边流路级少图山统接知较将组见计别她手角期根论运农指几九区强放决西被干做必战先回则任取据处府研局ABCDEFGHJKLMNPRSTUVWXYZ0123456789');
const PAGES = [
  ['2025年3月', [['新会话', '已归档'], ['帮我写个周报', '已归档'], ['周报改短一点', '已延误'], ['周报再改短点', '已延误'], ['解释这段正则', '已归档'], ['代码报错求助', '找不到'], ['新会话(2)', '未命名'], ['给猫取名字', '已完成'], ['下雨天干嘛', '已归档'], ['早餐吃什么', '已归档']]],
  ['2025年9月', [['旅行清单', '已归档'], ['简历润色', '已完成'], ['简历再润色', '已延误'], ['向量数据库是啥', '已归档'], ['新会话(3)', '未命名'], ['debug第47轮', '进行中'], ['阳台种什么好', '已归档'], ['周末去哪', '找不到'], ['帮我起个标题', '已归档'], ['新会话(4)', '未命名']]],
  ['2026年4月', [['骑行路线规划', '已归档'], ['论文文献综述', '进行中'], ['习惯追踪App', '进行中'], ['番茄炒蛋做法', '已完成'], ['方案讨论v1', '已归档'], ['方案讨论v2', '已归档'], ['新会话(5)', '未命名'], ['预算表格', '找不到'], ['会议纪要', '已归档'], ['年终总结', '已延误']]],
  ['上周', [['方案讨论v3', '找不到'], ['v3最终版', '找不到'], ['v3真·最终版', '找不到'], ['猫一直踩键盘', '已读'], ['今晚吃什么', '饿了'], ['77BPM快吗', '偏慢'], ['新会话(6)', '未命名'], ['那个方案呢', '找不到'], ['那个方案呢??', '找不到'], ['求求了在哪', '救命']]],
];
const PAGE_T = [4.62, 5.86, 7.06, 8.22];
const TILES = [];
function pageChars(p) { // per tile chars for a page: row 0 = date, rows 1..10 = title(9)+status(3)
  const [date, rows] = PAGES[p]; const out = [];
  out.push(Array.from(date.padEnd(12, ' ')).slice(0, 12).map(c => c));
  rows.forEach(([a, b]) => { const ta = Array.from(a); while (ta.length < 9) ta.push(' '); const tb = Array.from(b); while (tb.length < 3) tb.push(' '); out.push([...ta.slice(0, 9), ...tb.slice(0, 3)]); });
  return out;
}
{
  const r = rng(42);
  const pages = PAGES.map((_, i) => pageChars(i));
  for (let row = 0; row < 11; row++) for (let col = 0; col < NT; col++) {
    const el = h('div', 'tile'); el.innerHTML = '<div class="h top"><span></span></div><div class="h bot"><span></span></div><div class="leaf"><span></span></div>';
    const x = BX + col * (TW + TG) + (col >= 9 ? 30 : 0) - (col >= 9 ? 30 : 0);
    el.style.left = (row === 0 ? BX + col * (TW + TG) : BX + col * (TW + TG) + (col >= 9 ? 22 : 0) - (col >= 9 ? 22 : 0)) + 'px';
    el.style.top = (BY + row * PITCH) + 'px';
    if (row === 0) el.classList.add('amber');
    boardEl.appendChild(el);
    const chars = [' '], times = [];
    let cur = ' ';
    pages.forEach((pg, p) => {
      const target = pg[row][col];
      if (target === cur && r() < .7) return;
      const n = 2 + Math.floor(r() * (p === 3 ? 5 : 4));
      let tt = PAGE_T[p] + row * 0.048 + col * 0.021 + r() * 0.05;
      for (let k = 0; k < n; k++) { chars.push(POOL[Math.floor(r() * POOL.length)]); times.push(tt); tt += FD + .004; }
      chars.push(target); times.push(tt); cur = target;
    });
    times.forEach(tt => cue(tt, 'flap'));
    const status = col >= 9 && row > 0;
    TILES.push({ el, chars, times, top: el.querySelector('.top span'), bot: el.querySelector('.bot span'), leaf: el.querySelector('.leaf'), leafS: el.querySelector('.leaf span'), status, lastKey: '' });
  }
  // status colour per final page row
}
function statusClass(c3) { const s = c3.join('').trim(); if (/找不到|救命/.test(s)) return 'red'; if (/延误|饿了|偏慢/.test(s)) return 'amber'; return 'dim'; }
function sBoard(t) {
  const o = seg(t, T_BOARD_IN, T_BOARD_IN + .25) * (1 - seg(t, T_BOARD_OUT, T_BOARD_OUT + .3));
  show(boardEl, o > 0); if (o <= 0) return; op(boardEl, o);
  boardEl.style.transform = `translateY(${-40 * seg(t, T_BOARD_IN, T_BOARD_OUT)}px)`;
  TILES.forEach(T => {
    let k = 0; while (k < T.times.length && T.times[k] <= t) k++;
    let top, bot, leafMode = 0, leafC = '', ang = 0;
    if (k === 0) { top = bot = T.chars[0]; }
    else {
      const i = k - 1, p = (t - T.times[i]) / FD;
      if (p >= 1) { top = bot = T.chars[i + 1]; }
      else {
        const from = T.chars[i], to = T.chars[i + 1];
        top = to; bot = from;
        if (p < .5) { leafMode = 1; leafC = from; ang = -180 * p; } else { leafMode = 2; leafC = to; ang = 180 * (1 - p); }
      }
    }
    const key = top + bot + leafMode + leafC + ang.toFixed(0);
    if (key === T.lastKey) return; T.lastKey = key;
    T.top.textContent = top; T.bot.textContent = bot;
    if (!leafMode) T.leaf.style.display = 'none';
    else {
      T.leaf.style.display = '';
      T.leafS.textContent = leafC;
      if (leafMode === 1) { T.leaf.style.cssText = `top:0;border-radius:7px 7px 0 0;background:linear-gradient(#3a414d,#2a2f37);transform-origin:50% 100%;transform:perspective(320px) rotateX(${ang}deg)`; T.leafS.style.top = '0px'; }
      else { T.leaf.style.cssText = `top:43px;border-radius:0 0 7px 7px;background:linear-gradient(#262a31,#1a1d22);transform-origin:50% 0;transform:perspective(320px) rotateX(${ang}deg)`; T.leafS.style.top = '-43px'; }
    }
  });
  // colour status columns by what they currently read
  for (let row = 1; row < 11; row++) {
    const cells = TILES.slice(row * NT + 9, row * NT + 12);
    const cls = statusClass(cells.map(c => c.top.textContent));
    cells.forEach(c => { c.el.classList.toggle('red', cls === 'red'); c.el.classList.toggle('amber', cls === 'amber'); c.el.classList.toggle('dim', cls === 'dim'); });
  }
}

/* =========================================================== CHAT (wrong sessions) */
const chatEl = $('#chat');
chatEl.innerHTML = `
  <div class="chatTop"><span class="back">‹</span><div><div class="ct" id="ct"></div><div class="cs">那个大项目 · 默认模型</div></div></div>
  <div class="msgs"><div class="ub" id="cu"></div><div class="aiw" id="caw"><div class="av">${WHALE}</div><div class="at" id="ca"></div></div></div>
  <div class="cinput">给 DSH 发送消息…</div>
  <div class="counter" id="ccount"></div>
  <div class="stamp" id="cstamp">不是这个！</div>`;
const TAKES = [
  { w: T_CHAT, title: '方案讨论 v3', u: 12.47, a: 13.0, e: 14.0, user: '猫一直踩我键盘怎么办 😿', ai: [['它可能只是想陪你上班 🐱\n在键盘旁边放个纸箱试试，大多数猫都抗拒不了纸箱。']], stamp: B(-13), n: 7 },
  { w: 15.2, title: '方案讨论 v3（最终版）', u: 15.3, a: 15.62, e: 16.1, user: '今晚吃什么？', ai: [['番茄炒蛋怎么样？\n10 分钟出锅，酸甜又下饭 🍅']], stamp: B(-11), n: 15 },
  { w: 16.62, title: '方案讨论 v3（真·最终版）', u: 16.7, a: 16.92, e: 17.72, user: '77 BPM 算快还是慢？', ai: [['偏慢，很适合散步 🎵\n对了，想找以前聊过的内容，可以试试侧边栏'], ['最上面那个 ☝️', 'tip']], stamp: null, n: 23 },
];
TAKES.forEach(k => { cue(k.u, 'pop', { g: .5 }); if (k.stamp) { cue(k.stamp, 'stamp'); cue(k.stamp + .05, 'womp'); } });
cue(15.2 - .1, 'swish', { g: .45 }); cue(16.62 - .1, 'swish', { g: .45 }); cue(17.8, 'sparkle', { g: .35 }); cue(T_WHOOSH - .05, 'swish', { g: .3 });
function sChat(t, CUR) {
  const vis = t > T_CHAT && t < T_WHOOSH + .25; show(chatEl, vis); if (!vis) return;
  let x = 1080 * (1 - E.o(seg(t, T_CHAT, T_CHAT + .45)));
  for (const w of [15.2, 16.62]) {
    if (t > w - .12 && t < w) x = -1080 * E.i(seg(t, w - .12, w));
    if (t >= w && t < w + .16) x = 1080 * (1 - E.o(seg(t, w, w + .16)));
  }
  x += 1080 * E.i(seg(t, T_WHOOSH, T_WHOOSH + .22));
  let k = 0; if (t >= 15.2) k = 1; if (t >= 16.62) k = 2; const K = TAKES[k];
  let shake = 0; if (K.stamp && t > K.stamp && t < K.stamp + .2) shake = 14 * Math.sin((t - K.stamp) * 90) * (1 - seg(t, K.stamp, K.stamp + .2));
  chatEl.style.transform = `translate(${x + shake}px,0)`;
  $('#ct').textContent = K.title;
  const cu = $('#cu'); cu.textContent = K.user; op(cu, seg(t, K.u, K.u + .08)); cu.style.transform = `scale(${lerp(.85, 1, E.ob(seg(t, K.u, K.u + .2)))})`; cu.style.transformOrigin = '100% 100%';
  const ca = $('#ca'), caw = $('#caw');
  op(caw, seg(t, K.u + .12, K.u + .2));
  const total = K.ai.reduce((s, p) => s + Array.from(p[0]).length, 0);
  let n = Math.floor(total * seg(t, K.a, K.e));
  if (t < K.a) { ca.innerHTML = '<span class="dots">' + '•••'.slice(0, 1 + Math.floor((t * 6) % 3)) + '</span>'; }
  else {
    let html = '';
    for (const [txt, cls] of K.ai) { const arr = Array.from(txt); const part = arr.slice(0, Math.max(0, n)).join(''); n -= arr.length; if (!part) break; html += cls ? `<span class="${cls}">${esc(part)}</span>` : esc(part); }
    ca.innerHTML = html;
    const tip = ca.querySelector('.tip');
    if (tip) { const p = seg(t, 17.8, 18.05); tip.style.background = `linear-gradient(90deg,#ffe27a ${p * 100}%,rgba(255,226,122,0) ${p * 100}%)`; tip.style.color = '#a75b1e'; }
  }
  const st = $('#cstamp');
  if (K.stamp && t >= K.stamp) { const p = seg(t, K.stamp, K.stamp + .13); op(st, Math.min(1, p * 3)); st.style.transform = `translate(-50%,-50%) rotate(-10deg) scale(${lerp(2.4, 1, E.o(p))})`; }
  else op(st, 0);
  const cc = $('#ccount'); cc.textContent = `🔎 已翻找 ${K.n} 个会话`; op(cc, seg(t, 12.5, 12.7));
  if (t < 17.4) Object.assign(CUR, { vis: true, x: 840, y: 1430, s: 1.25, o: seg(t, 12.2, 12.4) });
}

/* =========================================================== 3D WORLD */
const world = $('#world');
const P3 = {};
function add3(id, cls, w, hh, html, x, y, z) { const el = h('div', 'p3 ' + cls, html); el.style.width = w + 'px'; el.style.height = hh + 'px'; world.appendChild(el); P3[id] = { el, w, h: hh, x, y, z }; return el; }
add3('L3', 'plane', 840, 360, `<div class="dbw"><div class="db"><div class="dbt">🗂 话题目录</div><div class="dbs">SQLite<br>话题 · 摘要<br>来源范围 · 路由记录</div></div><div class="db"><div class="dbt">📜 原始对话</div><div class="dbs">仍由 DSH 保存<br>消息 · 工具结果 · 回复</div></div></div>`, 0, 0, -680);
const WK = [['cycle', '🚴 周末骑行', -188, -122], ['garden', '🌿 阳台花园', 188, -122], ['paper', '📚 研究提案', -188, 122], ['habit', '✅ 习惯追踪', 188, 122]];
WK.forEach(([id, name, x, y]) => add3(id, 'plane', 350, 220, `<div class="wk"><div class="wt">${name}</div><div class="ws">独立 DSH 工作会话</div><div class="badge">📎 已挂载摘要</div></div>`, x, y, -330));
add3('cat', 'plane', 380, 200, `<div class="wk"><div class="wt">🐱 自动喂食器</div><div class="ws">新话题 · 新会话</div></div>`, 0, 380, -330);
add3('L1', 'plane', 800, 370, `<div class="rt">🧭 LLM 路由器</div><div class="rs">话题目录 + 最近 12 条消息 + 本轮输入</div><div class="code" id="rcode"></div><div class="rres" id="rres"></div><div class="chips">${['KEEP', 'MOUNT', 'SWAP', 'CREATE', 'CLARIFY'].map(a => `<span data-a="${a}">${a}</span>`).join('')}</div>`, 0, 0, 40);
add3('L0', 'plane mainp', 740, 380, `<div class="mh"><span class="osym"></span><b>The One</b><span>· 主聊天</span></div><div class="ml" id="mu"></div><div class="ml ai" id="ma"></div>`, 0, 0, 400);
// beams
const BEAMS = [];
const beamSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
beamSvg.setAttribute('width', 1080); beamSvg.setAttribute('height', 1920); beamSvg.style.cssText = 'position:absolute;left:0;top:0';
beamSvg.innerHTML = '<defs><filter id="bglow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5"/></filter></defs>';
$('#cam3d').insertBefore(beamSvg, world);
const capLayer = h('div', null); capLayer.style.cssText = 'position:absolute;left:0;top:0;width:1080px;height:1920px'; $('#cam3d').appendChild(capLayer);
function beam(x, y, z1, z2) { const g = document.createElementNS('http://www.w3.org/2000/svg', 'g'); g.innerHTML = '<line stroke="rgba(140,190,255,.9)" stroke-width="10" filter="url(#bglow)"/><line stroke="#cfe2ff" stroke-width="3"/>'; beamSvg.appendChild(g); BEAMS.push({ g, x, y, z1, z2 }); }
beam(0, 0, 400, 40); WK.forEach(([, , x, y]) => beam(x, y, 40, -330)); beam(-188, -122, -330, -680); beam(188, 122, -330, -680);
let WM = new DOMMatrix();
function proj(x, y, z) { const q = WM.transformPoint(new DOMPoint(x, y, z)); const k = 3200 / (3200 - q.z); return [540 + (q.x - 540) * k, 960 + (q.y - 960) * k]; }
// flying capsules
const FLIGHTS = [
  { text: '骑行路线 + 午饭？', a: 0, keys: [[B(8.5), 0, 0, 400], [B(9.4), 0, 0, 70], [B(10.3), 0, 0, 70], [B(10.85), -188, -122, 70], [B(11.3), -188, -122, -300]] },
  { text: '河边面馆 · 18km 🍜', a: 1, keys: [[B(12), -188, -122, -300], [B(12.55), -188, -122, 70], [B(12.75), 0, 0, 70], [B(13.05), 0, 0, 400]] },
  { text: '新话题：猫咪喂食器', a: 0, keys: [[B(14.3), 0, 0, 400], [B(15), 0, 0, 70], [B(15.3), 0, 0, 70], [B(15.55), 0, 380, 70], [B(15.95), 0, 380, -300]] },
  { text: '那个改一下', a: 0, keys: [[B(17.2), 0, 0, 400], [B(17.9), 0, 0, 70]] },
  { text: '🤔 先问一句', a: 1, keys: [[B(18.25), 0, 0, 70], [B(18.6), 0, 0, 400]] },
];
FLIGHTS.forEach(F => { F.el = h('div', 'cap3' + (F.a ? ' a' : ''), esc(F.text)); capLayer.appendChild(F.el); cue(F.keys[0][0], 'swish', { g: .22 }); });
const RST = [
  { t: B(9.5), code: '{"action":"EXISTING","contextId":"cycle"}', res: '→ SWAP · 切回「周末骑行」', chip: 'SWAP', ct: B(10.2) },
  { t: B(15), code: '{"action":"CREATE","title":"自动喂食器"}', res: '→ CREATE · 开一个新话题', chip: 'CREATE', ct: B(15.35) },
  { t: B(18), code: '{"action":"CLARIFY","question":"…"}', res: '→ CLARIFY · 先问清楚，不乱切', chip: 'CLARIFY', ct: B(18.25) },
];
RST.forEach(r => { for (let i = 0; i < 12; i++) cue(r.t + i * .045, 'tick', { g: .18 }); cue(r.ct, 'ding', { n: r.chip === 'SWAP' ? 'G5' : r.chip === 'CREATE' ? 'C6' : 'E5' }); });
const L0MSG = [
  { t: B(8), u: '骑行路线加个吃午饭的地方', a: '' }, { t: B(13.05), a: '河边面馆在 18km 处，正好歇脚 🍜' },
  { t: B(14), u: '新话题：给猫做个喂食器', a: '' }, { t: B(16.3), a: '好嘞！已经开了新话题 🐱' },
  { t: B(17), u: '那个改一下', a: '' }, { t: B(18.6), a: '改「骑行路线」还是「喂食器」？😊' },
];
L0MSG.forEach(m => cue(m.t, 'pop', { g: .45 }));
cue(B(1), 'drop3d'); cue(B(2), 'drop3d', { g: .8 }); cue(B(3), 'drop3d', { g: .7 }); cue(B(11.3), 'ding', { n: 'E5', g: .7 }); cue(B(15.95), 'sparkle', { g: .6 });

function sWorld(t, CUR) {
  const vis = t >= D && t < B(20); show($('#cam3d'), vis); if (!vis) return;
  const rx = track(t, [[B(0), 0], [B(2.3), 56, 'io'], [B(20), 53]]);
  const rz = track(t, [[B(0), 0], [B(2.3), -22, 'io'], [B(8), -28, 'ioq'], [B(20), -16, 'ioq']]);
  const s = track(t, [[B(0), 1.45], [B(2.3), .96, 'io'], [B(8), .98], [B(20), 1.01]]);
  const zc = track(t, [[B(0), 400], [B(2.3), -150, 'io']]);
  const cy = track(t, [[B(0), 0], [B(2.3), 40, 'io']]);
  const cx = 36 * seg(t, B(0), B(2.3));
  world.style.transform = `translate(${540 + cx}px,${960 + cy}px) scale3d(${s},${s},${s}) rotateX(${rx}deg) rotateZ(${rz}deg) translateZ(${-zc}px)`;
  WM = new DOMMatrix().translate(540 + cx, 960 + cy).scale(s, s, s).rotateAxisAngle(1, 0, 0, rx).rotateAxisAngle(0, 0, 1, rz).translate(0, 0, -zc);
  const place = (id, z, o, sc = 1) => { const p = P3[id]; p.el.style.transform = `translate3d(${p.x - p.w / 2}px,${p.y - p.h / 2}px,${z}px) scale(${sc})`; op(p.el, o); show(p.el, o > 0); };
  place('L0', 400, 1);
  const a1 = E.o(seg(t, B(1), B(1) + .5)); place('L1', lerp(400, 40, a1), seg(t, B(1), B(1) + .2));
  WK.forEach(([id], i) => { const st = B(2) + i * .07, a = E.o(seg(t, st, st + .5)); place(id, lerp(40, -330, a), seg(t, st, st + .2)); });
  const a3 = E.o(seg(t, B(3), B(3) + .5)); place('L3', lerp(-330, -680, a3), seg(t, B(3), B(3) + .2));
  const nc = seg(t, B(15.85), B(16.35)); place('cat', -330, Math.min(1, nc * 3), nc > 0 ? E.ob(nc) : .01);
  // glows
  P3.cycle.el.style.boxShadow = t > B(11.3) && t < B(13.5) ? '0 0 80px 10px rgba(255,170,80,.7)' : '';
  P3.cycle.el.style.borderColor = t > B(11.3) && t < B(13.5) ? '#ffb35c' : '';
  op(P3.cycle.el.querySelector('.badge'), seg(t, B(11.3), B(11.5)));
  P3.L1.el.style.boxShadow = RST.some(r => t > r.t && t < r.ct + .5) ? '0 0 90px 12px rgba(120,170,255,.6)' : '';
  // beams
  const bo = seg(t, B(3.5), B(4.5));
  BEAMS.forEach(b => { const [x1, y1] = proj(b.x, b.y, b.z1), [x2, y2] = proj(b.x, b.y, b.z2); b.g.querySelectorAll('line').forEach(l => { l.setAttribute('x1', x1); l.setAttribute('y1', y1); l.setAttribute('x2', x2); l.setAttribute('y2', y2); }); b.g.style.opacity = bo * .85; });
  // router text
  let r = null; RST.forEach(x => { if (t >= x.t) r = x; });
  const code = $('#rcode'), res = $('#rres');
  if (!r) { code.textContent = t > B(3) ? '等待输入…' : ''; code.style.color = '#6f7ca3'; res.textContent = ''; }
  else { const arr = Array.from(r.code); code.textContent = arr.slice(0, Math.floor(arr.length * seg(t, r.t, r.t + .55))).join(''); code.style.color = '#9ef0c0'; res.textContent = t > r.ct ? r.res : ''; }
  P3.L1.el.querySelectorAll('.chips span').forEach(c => c.classList.toggle('on', !!r && t > r.ct && c.dataset.a === r.chip));
  // main chat
  let mu = '', ma = '', mt = -1;
  L0MSG.forEach(m => { if (t >= m.t) { if (m.u != null) { mu = m.u; ma = ''; } if (m.a) ma = m.a; mt = m.t; } });
  $('#mu').textContent = mu ? '你：' + mu : (t > B(4) ? '有什么想聊的？' : ''); $('#ma').textContent = ma ? ma : '';
  op($('#ma'), ma ? 1 : 0);
  // capsules (billboards)
  FLIGHTS.forEach(F => {
    const k = F.keys, t0 = k[0][0], t1 = k[k.length - 1][0];
    const o = seg(t, t0 - .05, t0 + .1) * (1 - seg(t, t1, t1 + .15));
    show(F.el, o > 0); if (o <= 0) return;
    const pos = track(t, k.map(([tt, x, y, z], i) => [tt, [x, y, z], 'io']));
    const [px, py] = proj(pos[0], pos[1], pos[2]);
    F.el.style.transform = `translate(${px}px,${py}px) translate(-50%,-115%)`;
    op(F.el, o);
  });
}

/* =========================================================== CATALOG */
const catEl = $('#cat');
const GROUPS = [
  { name: '那个大项目', y: 430, items: ['方案讨论 v1', '方案讨论 v2', '方案讨论 v3', '预算表格', '会议纪要'] },
  { name: '生活日常', y: 830, items: ['猫一直踩键盘', '今晚吃什么', '骑行路线规划', '阳台种什么好', '番茄炒蛋做法'] },
  { name: '学习研究', y: 1230, items: ['论文文献综述', '向量数据库是啥', '解释这段正则', 'debug 第 47 轮', '77 BPM 快吗'] },
];
catEl.innerHTML = '<div class="cathead" id="cathead">话题工作区 · 15 个话题 · 3 个分组 · 历史目录已更新</div>';
GROUPS.forEach((g, gi) => { g.el = h('div', 'gcard', `<div class="gt">${g.name}<small>${g.items.length}</small></div>`); g.el.style.top = g.y + 'px'; catEl.appendChild(g.el); });
const CHIPS = [];
{
  const r = rng(5); let i = 0;
  GROUPS.forEach((g, gi) => g.items.forEach((it, j) => {
    const el = h('div', 'chip', '💬 ' + esc(it)); catEl.appendChild(el);
    CHIPS.push({ el, gi, j, x0: 70 + r() * 560, y0: 470 + r() * 1150, rot: -12 + r() * 24, ph: r() * 6, d: i++ * .035 });
  }));
}
const contBtn = h('div', 'cont', '继续聊天'); contBtn.style.top = (430 + 96 + 2 * 52 - 2) + 'px'; catEl.appendChild(contBtn);
const sheet = h('div', 'sheet', `<div class="av">${WHALE}</div><div class="at" id="sheetT"></div>`); catEl.appendChild(sheet);
const SHEET_TXT = '欢迎回来！上次我们聊到方案 v3 的预算部分，要接着来吗？😊';
cue(B(20), 'swoosh', { g: .6 }); cue(B(22), 'whoosh', { g: .5, dur: .9 }); cue(B(23.4), 'ding', { n: 'C6', g: .6 });
cue(B(25.75), 'click', { g: .9 }); cue(B(26), 'pop', { g: .5 }); cue(B(26.1), 'sparkle', { g: .7 });
function sCat(t, CUR) {
  const vis = t >= B(20) && t < B(28); show(catEl, vis); if (!vis) return;
  const lt = E.io(seg(t, B(23.6), B(24.4)));
  catEl.style.background = `rgb(${lerp(11, 247, lt)},${lerp(16, 248, lt)},${lerp(34, 250, lt)})`;
  op($('#cathead'), lt);
  GROUPS.forEach((g, gi) => {
    const a = E.o(seg(t, B(21.6) + gi * .1, B(22.2) + gi * .1));
    op(g.el, a); g.el.style.transform = `scale(${lerp(.92, 1, a)})`;
    g.el.style.background = `rgba(${lerp(28, 255, lt)},${lerp(38, 255, lt)},${lerp(72, 255, lt)},${lerp(.6, 1, lt)})`;
    g.el.style.borderColor = lt > .5 ? '#e6e8ec' : 'rgba(160,190,255,.35)';
    g.el.style.boxShadow = lt > .5 ? '0 10px 30px rgba(0,0,0,.06)' : 'none';
    g.el.querySelector('.gt').style.color = lt > .5 ? '#16181c' : '#fff';
  });
  CHIPS.forEach(C => {
    const g = GROUPS[C.gi];
    const p = E.io(seg(t, B(22) + C.d, B(22) + C.d + .75));
    const fx = C.x0 + 14 * Math.sin(t * 1.4 + C.ph), fy = C.y0 + 12 * Math.cos(t * 1.1 + C.ph);
    const tx = 120, ty = g.y + 96 + C.j * 52;
    const x = lerp(fx, tx, p), y = lerp(fy, ty, p);
    const sc = lerp(1, .86, p), rot = lerp(C.rot, 0, p);
    C.el.style.transform = `translate(${x}px,${y}px) rotate(${rot}deg) scale(${sc})`; C.el.style.transformOrigin = '0 0';
    op(C.el, seg(t, B(20) + C.d, B(20) + C.d + .2));
    const hl = C.gi === 0 && C.j === 2 && t > B(24.3);
    C.el.style.background = lt > .5 ? (hl ? '#fff1e3' : 'transparent') : '#262b33';
    C.el.style.color = lt > .5 ? '#1f2328' : '#eee';
    C.el.style.borderColor = lt > .5 ? (hl ? '#f3b37a' : 'transparent') : '#3a404a';
    C.el.style.fontWeight = hl ? '700' : '500';
  });
  op(contBtn, seg(t, B(24.2), B(24.5)));
  contBtn.style.transform = `scale(${t > B(25.68) && t < B(25.85) ? .94 : 1})`;
  contBtn.style.background = t > B(25.2) ? '#fff5ec' : '#fff'; contBtn.style.borderColor = t > B(25.2) ? '#f3b37a' : '#d9dce1';
  const sp = E.o(seg(t, B(26), B(26.5)));
  op(sheet, sp); sheet.style.transform = `translateY(${(1 - sp) * 300}px)`;
  const arr = Array.from(SHEET_TXT); $('#sheetT').textContent = arr.slice(0, Math.floor(arr.length * seg(t, B(26.3), B(27.4)))).join('');
  if (t > B(24.2) && t < B(27.6)) {
    const cr = contBtn.getBoundingClientRect();
    const tx = cr.left + cr.width * .55, ty = cr.top + cr.height * .6;
    Object.assign(CUR, { vis: true, x: track(t, [[B(24.3), 960], [B(25.5), tx, 'io']]), y: track(t, [[B(24.3), 1560], [B(25.5), ty, 'io']]), s: 1.25, o: seg(t, B(24.2), B(24.4)) * (1 - seg(t, B(27.2), B(27.6))),
      hand: t > B(25.2), press: Math.abs(t - B(25.75)) < .07, rip: seg(t, B(25.75), B(25.75) + .45) });
  }
}

/* =========================================================== FEATURES */
const featEl = $('#feat');
const FEATS = [
  ['🔑', '不用再填 API Key', '直接复用 DSH 已配置的模型和凭据'],
  ['🧵', '一个话题，一个工作会话', '回到项目，接着上次的进度聊'],
  ['🔍', '需要时才翻原始记录', '只读批准过的片段，不搬整段历史'],
  ['🛡️', '拿不准就不乱切', '路由失败原地不动；有歧义先问你'],
  ['🌏', '中文 / English 即时切换', '跟随 DSH 的界面语言'],
];
const FT = [B(28.3), B(29.8), B(31.3), B(32.8), B(34.0)];
FEATS.forEach((f, i) => { const el = h('div', 'fcard', `<div class="fe">${f[0]}</div><div><div class="ft">${f[1]}</div><div class="fs">${f[2]}</div></div>`); el.style.top = (410 + i * 232) + 'px'; featEl.appendChild(el); f.el = el; cue(FT[i], 'thud'); cue(FT[i] - .12, 'swish', { g: .35 }); });
function sFeat(t) {
  const vis = t >= B(28) && t < B(36.2); show(featEl, vis); if (!vis) return;
  FEATS.forEach((f, i) => {
    const p = E.ob(seg(t, FT[i] - .12, FT[i] + .2)), out = E.i(seg(t, B(35.4) + i * .05, B(36) + i * .05));
    f.el.style.transform = `translate(${(1 - p) * 1100 - out * 1200}px,0) rotate(${(1 - p) * 8}deg)`;
    op(f.el, seg(t, FT[i] - .12, FT[i] - .02));
  });
}

/* =========================================================== END CARD */
const endEl = $('#end');
endEl.innerHTML = `
  <div class="tag" id="etag">所有聊天，一个入口。</div>
  <div class="tag2" id="etag2">你只管聊，剩下的交给 The One</div>
  <div class="one bigone" id="eone">${ONE_INNER}</div>
  <div class="install" id="einst"><div class="s">DSH → 插件 → 添加插件 → 粘贴：</div><div class="u">github.com/YunongDai2005/dsh-theone</div></div>
  <div class="perks" id="eperks">开源 · 中英双语 · 复用 DSH 模型</div>
  <div class="plan" id="eplan">It's all part of The One's plan ✨</div>
  <div class="disc" id="edisc">非官方社区插件 · 与 DeepSeek 无隶属关系</div>`;
cue(B(36), 'swoosh', { g: .6 }); cue(B(36.2), 'sparkle', { g: .7 }); cue(B(39), 'click', { g: .7 }); cue(B(39.05), 'ding', { n: 'G5', g: .5 }); cue(B(41), 'sparkle', { g: .5 });
function sEnd(t, CUR) {
  const vis = t >= B(35.9); show(endEl, vis); if (!vis) return;
  const dk = E.io(seg(t, B(39), B(39.5)));
  const mix = (a, b) => `rgb(${a.map((v, i) => Math.round(lerp(v, b[i], dk))).join(',')})`;
  endEl.style.background = mix([255, 250, 244], [15, 23, 32]);
  op(endEl, seg(t, B(35.9), B(36.2)));
  const pop = (id, a) => { const el = $(id), p = seg(t, a, a + .35); op(el, p); el.style.transform = `translateY(${(1 - E.o(p)) * 40}px)`; };
  pop('#etag', B(36.4)); pop('#etag2', B(37)); pop('#einst', B(37.6)); pop('#eperks', B(38.2)); pop('#eplan', B(40.6)); pop('#edisc', B(41));
  $('#etag').style.color = mix([22, 24, 28], [240, 244, 250]);
  $('#etag2').style.color = $('#eperks').style.color = mix([107, 111, 118], [160, 172, 190]);
  $('#eplan').style.color = mix([167, 91, 30], [147, 200, 243]);
  const inst = $('#einst'); inst.style.background = mix([255, 255, 255], [29, 42, 55]); inst.style.borderColor = dk > .5 ? '#344d64' : '#eee';
  inst.querySelector('.s').style.color = mix([85, 85, 85], [180, 190, 205]);
  const u = inst.querySelector('.u'); u.style.background = mix([244, 245, 247], [20, 30, 40]); u.style.color = mix([22, 24, 28], [230, 238, 248]);
  const one = $('#eone');
  const pulse = Math.pow(1 - ((t - D) / BEAT % 1), 3);
  const p = E.ob(seg(t, B(36), B(36.5)));
  one.style.transform = `scale(${lerp(.6, 1, p) * (1 + .02 * pulse)})`; op(one, seg(t, B(36), B(36.15)));
  one.style.background = mix([255, 245, 236], [29, 42, 55]); one.style.borderColor = dk > .5 ? '#344d64' : '#eed3bb';
  one.style.color = mix([167, 91, 30], [147, 200, 243]);
  one.querySelectorAll('.othe,.osub').forEach(e => e.style.color = mix([107, 111, 118], [160, 172, 190]));
  const gc = dk > .5 ? '128,186,233' : '255,120,20';
  one.style.boxShadow = `0 0 ${60 + 40 * pulse}px ${10 + 10 * pulse}px rgba(${gc},${.3 + .2 * pulse})`;
  op($('#fade'), seg(t, TOTAL - .45, TOTAL));
  if (t > B(37)) {
    const r = one.getBoundingClientRect();
    const hop = Math.abs(Math.sin(((t - D) / BEAT) * Math.PI)) * 18;
    Object.assign(CUR, { vis: true, x: r.right - 70, y: r.bottom - 40 - hop, s: 1.2, o: seg(t, B(37), B(37.3)) * (1 - seg(t, TOTAL - .6, TOTAL - .3)), hand: true });
  }
}

/* =========================================================== CAPTIONS / FX */
const CAPS = [
  [0.05, 2.3, t => `我跟 AI 聊了 <span class="hl">${countAt(t).toLocaleString('en-US')}</span> 个会话`],
  [2.5, 4.45, '上周聊的那个方案……在哪？🤔'],
  [4.65, 5.85, '往上翻……'], [5.86, 7.05, '再往上翻……'], [7.06, 8.4, '还在翻…… 😵‍💫'], [8.45, 9.75, '上周的！应该就在这附近'],
  [9.8, 11.55, '打开「那个大项目」'],
  [20.0, 21.6, '等一下……'], [21.6, D - .05, '最上面这个……是什么？✨'],
  [B(0.5), B(4), '一个按钮的背后——'], [B(4), B(8), '藏着一整套<span class="hl">多会话调度</span> ⚙️'],
  [B(8), B(10), '你只管在主聊天里说话'], [B(10), B(14), 'AI 判断：这句属于<span class="hl">「周末骑行」</span>'],
  [B(14), B(17), '新的事？<span class="hl">自动开新话题</span>'], [B(17), B(19.9), '拿不准？<span class="hl">先问你</span>，不乱切'],
  [B(20.1), B(21.9), '那以前那 1,284 个会话呢？'], [B(22), B(25.6), '后台自动整理成<span class="hl">话题工作区</span>'],
  [B(26), B(27.9), '找到了！🎉 就是这个'], [B(28.1), B(35.4), '还有这些 👇'],
];
const capEl = $('#cap');
function sCaps(t) {
  let c = null; for (const k of CAPS) if (t >= k[0] && t < k[1]) c = k;
  if (!c) { op(capEl, 0); return; }
  const html = typeof c[2] === 'function' ? c[2](t) : c[2];
  if (capEl.innerHTML !== html) capEl.innerHTML = html;
  const p = seg(t, c[0], c[0] + .22), q = seg(t, c[1] - .12, c[1]);
  op(capEl, Math.min(1, p * 2) * (1 - q));
  capEl.style.transform = `scale(${lerp(.7, 1, E.ob(p)) * lerp(1, .9, q)})`;
}
const curEl = $('#cursor'), ripEl = $('#ripple'), sweatEl = $('#sweat');
let curShape = '';
function drawCursor(CUR) {
  if (!CUR.vis || !(CUR.o > 0)) { op(curEl, 0); op(ripEl, 0); op(sweatEl, 0); return; }
  const shape = CUR.hand ? 'hand' : 'arrow';
  if (shape !== curShape) { curEl.innerHTML = CUR.hand ? HAND : ARROW; curShape = shape; }
  const s = (CUR.s || 1) * (CUR.press ? .86 : 1);
  const hx = CUR.hand ? 14 * 62 / 32 : 2 * 50 / 24, hy = CUR.hand ? 1.5 * 70 / 36 : 2 * 74 / 35.5;
  curEl.style.transform = `translate(${CUR.x}px,${CUR.y}px) rotate(${CUR.rot || 0}deg) scale(${s},${s * (CUR.sy || 1)}) translate(${-hx}px,${-hy}px)`;
  op(curEl, CUR.o);
  if (CUR.rip > 0 && CUR.rip < 1) { op(ripEl, (1 - CUR.rip) * CUR.o); const r = lerp(.2, 1.6, E.o(CUR.rip)) * (CUR.s || 1); ripEl.style.transform = `translate(${CUR.x - 60}px,${CUR.y - 60}px) scale(${r})`; } else op(ripEl, 0);
  if (CUR.sweat > 0) { op(sweatEl, Math.min(1, CUR.sweat * 5) * (1 - seg(CUR.sweat, .8, 1))); sweatEl.style.transform = `translate(${CUR.x + 70}px,${CUR.y - 40 + 40 * E.i(CUR.sweat)}px)`; } else op(sweatEl, 0);
}
function sFlash(t) {
  let f = 0;
  f = Math.max(f, t >= D ? 1 - E.o(seg(t, D, D + .45)) : 0);
  for (const b of [B(20), B(28), B(36)]) if (t >= b) f = Math.max(f, .55 * (1 - E.o(seg(t, b, b + .3))));
  op($('#flash'), f);
}

/* =========================================================== MAIN */
let measured = false;
function render(t) {
  if (!measured) { measure(); measured = true; }
  const CUR = { vis: false };
  sDesk(t, CUR); sApp(t, CUR); sWorld(t, CUR); sCat(t, CUR); sFeat(t); sEnd(t, CUR);
  drawCursor(CUR); sCaps(t); sFlash(t);
  if (t < TOTAL - .45) op($('#fade'), 0);
}
window.render = render;
window.warm = async () => {
  for (let t = 0; t < TOTAL; t += .25) render(t);
  await document.fonts.ready;
  measured = false; render(0);
  await new Promise(r => setTimeout(r, 300));
  return CUES.length;
};
if (!navigator.webdriver) { window.warm().then(() => { const t0 = performance.now(); const loop = () => { const t = ((performance.now() - t0) / 1000) % TOTAL; render(t); requestAnimationFrame(loop); }; loop(); }); }

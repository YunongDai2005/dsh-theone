// usage: node render.mjs stills 0,1.5,3 outdir   |   node render.mjs video out.mp4 [fps]   |   node render.mjs cues cues.json
// env: PAGE (film.html, add ?theme=dark for night), SS supersample, VH stage height, START/END section,
//      CRF/PRESET encoder, WORKERS parallel browsers (default: half the CPU cores, max 8), GPU=1 hardware rendering
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { launch, renderer, GPU } from './pw.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const [mode, arg, arg2] = process.argv.slice(2);

const SS = +(process.env.SS || 1); // supersample: render at SS× and downsample with Lanczos
const VH = +(process.env.VH || 2160); // stage height: 2160 for 9:18
const PAGE = process.env.PAGE || 'film.html';
const browsers = [];
async function open() {
  const browser = await launch(); browsers.push(browser);
  const page = await browser.newPage({ viewport: { width: 1080, height: VH }, deviceScaleFactor: SS });
  page.on('pageerror', e => console.log('[pageerror]', e.message));
  const [file, query] = PAGE.split('?');
  await page.goto(pathToFileURL(path.join(here, file)).href + (query ? '?' + query : ''));
  await page.evaluate(() => window.warm());
  return { browser, page };
}
const main = await open(), page = main.page;
if (GPU) console.log('renderer', await renderer(page));
page.on('console', m => console.log('[page]', m.text()));
const TOTAL = await page.evaluate(() => window.TOTAL);
console.log('total', TOTAL);

if (mode === 'cues') {
  fs.writeFileSync(arg, JSON.stringify(await page.evaluate(() => window.CUES)));
} else if (mode === 'stills') {
  fs.mkdirSync(arg2, { recursive: true });
  for (const ts of arg.split(',')) {
    const t = +ts;
    await page.evaluate(t => window.render(t), t);
    const out = path.join(arg2, `f_${t.toFixed(2).padStart(6, '0')}.jpg`);
    const buf = await page.screenshot({ type: 'png' });
    await new Promise((res, rej) => { const f = spawn('ffmpeg', ['-y', '-v', 'error', '-i', '-', '-vf', `scale=1080:${VH}:flags=lanczos`, '-q:v', '2', out]); f.on('close', res); f.on('error', rej); f.stdin.end(buf); });
  }
} else if (mode === 'video') {
  const fps = +(arg2 || 30);
  const t0s = +(process.env.START || 0), t1s = +(process.env.END || TOTAL); // render only a section when START/END are set
  const n0 = Math.round(t0s * fps), n = Math.round(t1s * fps);
  // every frame is a pure function of t, so separate browsers can render interleaved frames in parallel
  const NW = Math.max(1, +(process.env.WORKERS || Math.min(8, Math.floor(os.cpus().length / 2))));
  const pages = [page];
  for (let k = 1; k < NW; k++) pages.push((await open()).page);
  console.log(`${n - n0} frames at ${fps} fps, SS=${SS}, ${NW} workers`);
  const ff = spawn('ffmpeg', ['-y', '-v', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
    '-vf', `scale=1080:${VH}:flags=lanczos`, '-c:v', 'libx264', '-preset', process.env.PRESET || 'slow', '-crf', process.env.CRF || '16', '-profile:v', 'high', '-level', '5.2', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', arg], { stdio: ['pipe', 'inherit', 'inherit'] });
  const t0 = Date.now();
  const shot = async (p, i) => { await p.evaluate(t => window.render(t), i / fps); return p.screenshot({ type: 'jpeg', quality: 96 }); };
  for (let i = n0; i < n; i += NW) {
    const bufs = await Promise.all(pages.slice(0, Math.min(NW, n - i)).map((p, k) => shot(p, i + k)));
    for (const buf of bufs) if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    const done = i + bufs.length - n0, el = (Date.now() - t0) / 1000;
    if (Math.floor((i - n0) / 150) !== Math.floor((i - n0 + bufs.length) / 150) || i + bufs.length >= n)
      console.log(`frame ${i + bufs.length}/${n}  ${el.toFixed(0)}s  ~${(el / done * (n - n0 - done) / 60).toFixed(1)} min left`);
  }
  ff.stdin.end();
  await new Promise(r => ff.on('close', r));
}
await Promise.all(browsers.map(b => b.close()));

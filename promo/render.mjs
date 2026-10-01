// usage: node render.mjs stills 0,1.5,3 outdir   |   node render.mjs video out.mp4 [fps]   |   node render.mjs cues cues.json
// env: PAGE (film.html, add ?theme=dark for night), SS supersample, VH stage height, START/END section,
//      CRF/PRESET x264 encoder, ENCODER=libx264|h264_amf, QP/AMF_QUALITY for AMD,
//      JPEG_QUALITY (default 96), WORKERS parallel browsers, GPU=1 hardware rendering
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
const JPEG_QUALITY = +(process.env.JPEG_QUALITY || 96);
const ENCODER = process.env.ENCODER || 'libx264';
if (!['libx264', 'h264_amf'].includes(ENCODER)) throw new Error('ENCODER must be libx264 or h264_amf');
if (!Number.isInteger(JPEG_QUALITY) || JPEG_QUALITY < 1 || JPEG_QUALITY > 100) throw new Error('JPEG_QUALITY must be an integer from 1 to 100');
const browsers = [];
async function prepareFrame(page, t) {
  await page.evaluate(async t => {
    window.render(t);
    // Flush layout, then allow painting/compositing after the CSS 3D and SVG updates.
    // Timeline time stays fixed while the browser catches up.
    document.documentElement.getBoundingClientRect();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }, t);
}
try {
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
    await prepareFrame(page, t);
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
  if (!Number.isInteger(NW)) throw new Error('WORKERS must be a positive integer');
  const pages = [page];
  for (let k = 1; k < NW; k++) pages.push((await open()).page);
  console.log(`${n - n0} frames at ${fps} fps, SS=${SS} (${1080 * SS}x${VH * SS}), JPEG=${JPEG_QUALITY}, ${NW} workers, encoder=${ENCODER}`);
  const encoderArgs = ENCODER === 'h264_amf'
    ? ['-quality', process.env.AMF_QUALITY || 'balanced', '-rc', 'cqp', '-qp_i', process.env.QP || '20', '-qp_p', String(+(process.env.QP || 20) + 2)]
    : ['-preset', process.env.PRESET || 'slow', '-crf', process.env.CRF || '16'];
  const ff = spawn('ffmpeg', ['-y', '-v', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
    ...(SS === 1 ? [] : ['-vf', `scale=1080:${VH}:flags=lanczos`]), '-c:v', ENCODER, ...encoderArgs,
    '-profile:v', 'high', '-level', '5.2', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', arg], { stdio: ['pipe', 'inherit', 'inherit'] });
  const ffDone = new Promise(resolve => {
    ff.once('error', error => resolve({ error }));
    ff.once('close', code => resolve({ code }));
  });
  let ffError;
  ff.on('error', error => { ffError = error; });
  ff.stdin.on('error', error => { ffError = error; });
  const t0 = Date.now();
  const shot = async (p, i) => { await prepareFrame(p, i / fps); return p.screenshot({ type: 'jpeg', quality: JPEG_QUALITY }); };
  // One pending frame per page bounds memory. Start its next shot while ffmpeg consumes this one.
  // Catch pending failures immediately, then report them when their frame reaches the output queue.
  const queueShot = (p, i) => shot(p, i).then(buf => ({ buf }), error => ({ error }));
  const pending = pages.map((p, k) => n0 + k < n ? queueShot(p, n0 + k) : null);
  try {
    for (let i = n0; i < n; i++) {
      const slot = (i - n0) % NW, { buf, error } = await pending[slot];
      if (error) throw error;
      if (ffError) throw ffError;
      pending[slot] = i + NW < n ? queueShot(pages[slot], i + NW) : null;
      await new Promise((resolve, reject) => ff.stdin.write(buf, error => error ? reject(error) : resolve()));
      const done = i + 1 - n0, el = (Date.now() - t0) / 1000;
      if (done % 150 === 0 || i + 1 >= n)
        console.log(`frame ${i + 1}/${n}  ${el.toFixed(0)}s  ~${(el / done * (n - n0 - done) / 60).toFixed(1)} min left`);
    }
    ff.stdin.end();
    const result = await ffDone;
    if (result.error) throw result.error;
    if (result.code !== 0) throw new Error(`ffmpeg (${ENCODER}) exited with code ${result.code}.` +
      (ENCODER === 'h264_amf' ? ' Ensure ffmpeg includes h264_amf and the AMD driver is installed, or use ENCODER=libx264.' : ''));
  } catch (error) {
    ff.stdin.destroy();
    ff.kill();
    throw error;
  }
}
} finally {
await Promise.all(browsers.map(b => b.close()));
}

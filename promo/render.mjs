// usage: node render.mjs stills 0,1.5,3 outdir   |   node render.mjs video out.mp4 [fps]   |   node render.mjs cues cues.json
import { createRequire } from 'module';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
const require = createRequire('/opt/node-tools/node_modules/');
const { chromium } = require('playwright');
const here = path.dirname(new URL(import.meta.url).pathname);
const [mode, arg, arg2] = process.argv.slice(2);

const browser = await chromium.launch();
const SS = +(process.env.SS || 1); // supersample: render at SS× and downsample with Lanczos
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: SS });
page.on('console', m => console.log('[page]', m.text()));
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto('file://' + path.join(here, process.env.PAGE || 'film.html'));
const ncues = await page.evaluate(() => window.warm());
const TOTAL = await page.evaluate(() => window.TOTAL);
console.log('cues', ncues, 'total', TOTAL);

if (mode === 'cues') {
  fs.writeFileSync(arg, JSON.stringify(await page.evaluate(() => window.CUES)));
} else if (mode === 'stills') {
  fs.mkdirSync(arg2, { recursive: true });
  for (const ts of arg.split(',')) {
    const t = +ts;
    await page.evaluate(t => window.render(t), t);
    const out = path.join(arg2, `f_${t.toFixed(2).padStart(6, '0')}.jpg`);
    const buf = await page.screenshot({ type: 'png' });
    await new Promise((res, rej) => { const f = spawn('ffmpeg', ['-y', '-v', 'error', '-i', '-', '-vf', 'scale=1080:1920:flags=lanczos', '-q:v', '2', out]); f.on('close', res); f.on('error', rej); f.stdin.end(buf); });
  }
} else if (mode === 'video') {
  const fps = +(arg2 || 30);
  const n = Math.round(TOTAL * fps);
  const ff = spawn('ffmpeg', ['-y', '-v', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
    '-vf', 'scale=1080:1920:flags=lanczos', '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', arg], { stdio: ['pipe', 'inherit', 'inherit'] });
  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    await page.evaluate(t => window.render(t), i / fps);
    const buf = await page.screenshot({ type: 'jpeg', quality: 96 });
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    if (i % 150 === 0) console.log(`frame ${i}/${n}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  ff.stdin.end();
  await new Promise(r => ff.on('close', r));
}
await browser.close();

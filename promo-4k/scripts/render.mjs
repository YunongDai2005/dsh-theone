// Local render: node scripts/render.mjs <light|dark>   → out/TheOne-<theme>-16x9-4k60.mp4
// env: SCALE (2 = 3840×2160, 1 = 1080p preview), CRF (default 16), CONCURRENCY (default: Remotion's choice)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
process.chdir(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const theme = process.argv[2] === 'dark' ? 'dark' : 'light';
const win = process.platform === 'win32';
const run = (cmd, args) => { const r = spawnSync(cmd, args, { stdio: 'inherit', shell: win && /^(npm|npx)$/.test(cmd) }); if (r.status !== 0) process.exit(r.status ?? 1); };
if (!fs.existsSync('public/mix.wav') || !fs.existsSync('src/generated/dsh-icons.json')) run('node', ['scripts/prepare.mjs']);
const scale = process.env.SCALE || '2', res = scale === '1' ? '1080p' : '4k';
const out = `out/TheOne-${theme}-16x9-${res}60.mp4`;
run('npx', ['remotion', 'render', theme === 'dark' ? 'TheOne-Dark' : 'TheOne-Light', out,
  `--scale=${scale}`, '--codec=h264', `--crf=${process.env.CRF || 16}`, '--x264-preset=slow', '--jpeg-quality=95',
  '--audio-codec=aac', '--audio-bitrate=320k', '--gl=angle',
  ...(process.env.CONCURRENCY ? [`--concurrency=${process.env.CONCURRENCY}`] : [])]);
console.log('→ ' + out);

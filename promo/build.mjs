// One-shot build, Windows / macOS / Linux:  node build.mjs [light|dark] [fps] [SS]
//   node build.mjs                 light, 60 fps, 3× supersampled  → TheOne-light-9x18-60fps.mp4
//   node build.mjs dark            night version                   → TheOne-dark-9x18-60fps.mp4
//   node build.mjs dark 30 1       quick preview (add CRF=28 PRESET=veryfast for a small file)
// Needs Node 18+, ffmpeg + ffprobe, Python 3 with numpy and scipy, git, and the BGM saved as promo/bgm.m4a.
// GPU=1 renders with the graphics card; WORKERS=n sets how many browsers render in parallel.
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const here = path.dirname(fileURLToPath(import.meta.url));
process.chdir(here);
const [THEME = 'light', FPS = '60', SS = '3'] = process.argv.slice(2);
const win = process.platform === 'win32';
const run = (cmd, args, env = {}, capture = false) => {
  const r = spawnSync(cmd, args, { stdio: capture ? ['inherit', 'pipe', 'inherit'] : 'inherit', env: { ...process.env, ...env }, shell: win && /^(npm|npx)$/.test(cmd), encoding: 'utf8' });
  if (r.status !== 0) { console.error(`\n✗ ${cmd} ${args.join(' ')} failed`); process.exit(1); }
  return r.stdout;
};
const has = (cmd, args = ['--version']) => spawnSync(cmd, args, { stdio: 'ignore', shell: win && /^(npm|npx)$/.test(cmd) }).status === 0;

if (!fs.existsSync('bgm.m4a')) { console.error('Put the BGM at promo/bgm.m4a first'); process.exit(1); }
for (const c of ['ffmpeg', 'ffprobe', 'git']) if (!has(c, c === 'git' ? ['--version'] : ['-version'])) { console.error('missing: ' + c); process.exit(1); }
const PY = ['python3', 'python', 'py'].find(p => has(p, ['-c', 'import numpy, scipy']));
if (!PY) { console.error('missing: Python 3 with numpy and scipy (pip install numpy scipy)'); process.exit(1); }

if (!fs.existsSync('node_modules/playwright')) { run('npm', ['install']); run('npx', ['playwright', 'install', 'chromium']); }
if (!fs.existsSync('../.dsh')) run('git', ['clone', '--depth', '1', 'https://github.com/deepseek-ai/deepseek-harness.git', '../.dsh']);
if (!fs.existsSync('dsh-icons.js')) {
  run('npx', ['esbuild', 'extract-icons.tsx', '--bundle', '--platform=node', '--format=esm', '--jsx=automatic', '--external:react', '--external:react-dom', '--external:react/jsx-runtime', '--outfile=.extract.mjs']);
  run('node', ['.extract.mjs']);
}
const dark = THEME === 'dark', PAGE = dark ? 'film.html?theme=dark' : 'film.html', FACE = dark ? 'face_dark.png' : 'face.png';
if (!fs.existsSync(FACE)) run('node', ['mkface.mjs'], { THEME });

// sound effects come from the film's own cue list, then get mixed with the BGM from 77.694 s so the drop hits 15.584 s
const TOTAL = +run('node', ['render.mjs', 'cues', 'cues.json'], { PAGE, GPU: '' }, true).match(/total ([\d.]+)/)[1];
fs.writeFileSync('meta.json', JSON.stringify({ total: TOTAL }));
run(PY, ['sfx.py']);
run('ffmpeg', ['-v', 'error', '-y', '-i', 'bgm.m4a', '-i', 'sfx.wav', '-filter_complex',
  `[0:a]aresample=48000,atrim=start=77.6942:duration=${TOTAL},asetpts=PTS-STARTPTS,afade=t=in:d=0.3,afade=t=out:st=${(TOTAL - 1.197).toFixed(3)}:d=1.2[m];[1:a]aresample=48000[s];[m][s]amix=inputs=2:normalize=0,alimiter=limit=0.95:level=false[a]`,
  '-map', '[a]', '-c:a', 'pcm_s16le', 'mix.wav']);

const OUT = `TheOne-${THEME}-9x18-${FPS}fps.mp4`, t0 = Date.now();
run('node', ['render.mjs', 'video', 'film_noaudio.mp4', FPS], { PAGE, SS });
console.log(`rendered in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
// audio and video are the same length, so no -shortest (it trims the last few frames of the fade)
run('ffmpeg', ['-v', 'error', '-y', '-i', 'film_noaudio.mp4', '-i', 'mix.wav', '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '320k', '-ar', '48000', '-movflags', '+faststart', OUT]);
run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height,r_frame_rate,nb_frames:format=duration', '-of', 'compact', OUT]);
console.log('→ ' + OUT);

# TheOne — 30-second vertical film

1080×1920, 30 fps, 28.9 s. English only, almost no on-screen text. Every frame is a pure function of `t` in `film.js`; Playwright screenshots each frame and ffmpeg encodes. All sound effects are synthesized by `sfx.py`.

The UI is a replica of the DSH web client built with DSH's own icons, whale mark and wordmark (`extract-icons.tsx` renders them from the `deepseek-harness` sources). The top 170 px stay background-only for the phone notch.

## Beat map

- BGM: 77 BPM, 4/4, one beat = 0.779 s.
- The BGM drop is at 1:33.279. The film uses the BGM from **80.811 s**, so the drop lands on **12.468 s = 16 beats in**: the frame where The One is clicked.
- Before the drop the music is an ambient pad, and the last 8 beats are silent. Every session switch lands on the beat grid, so the split-flap sounds carry the rhythm.
- After the drop each bar hits hard on **beats 1, 2¼ and 3**, and every post-drop action lands on those hits (`r(1)`, `r(2.25)`, `r(3)`, …).

| Beats | Shot | Sound |
| --- | --- | --- |
| 0–2 | The camera tracks the cursor across the dock; click DSH on beat 1; the window zooms open | Mouse click |
| 2–8 | Close-up of the session list, starting at the bottom. One session per beat; Archive opens on beat 4 | Split-flap rattle on every switch |
| 8–10 | Into the silence: switches speed up to 8th and then 16th notes | Faster flaps |
| 10.5–11.6 | Motion-blurred rush up the sidebar | Wind |
| 11.6–16 | The One: the UI dims, light rays and dust; the cursor drifts in | Pad, shimmer, reverse swell |
| **16 (drop)** | **Click → bloom → the UI tilts into 3D** | Click and sub impact |
| r1 / r2¼ / r3 | Layers drop in behind the button: router → 9 sessions → history | Layer thocks on the hits |
| r4–r8 | "Kyoto, day 3?" → router `SWAP` → *Trip to Kyoto* lights up → reply comes back | Blips on the hits |
| r8–r12 | "New topic: a cat feeder" → `CREATE` → a new session appears | Sparkle |
| r12–r16 | Old sessions snap into topic workspaces: TRAVEL / WORK / HOME | Snaps on r13, r14¼, r15 |
| r16–r20 | **The One** · One chat. Every context. · github.com/YunongDai2005/dsh-theone | Shimmer |

## Build

```sh
cd promo
npm install && pip install numpy scipy
git clone --depth 1 https://github.com/deepseek-ai/deepseek-harness.git ../.dsh
npx esbuild extract-icons.tsx --bundle --platform=node --format=esm --jsx=automatic \
  --external:react --external:react-dom --external:react/jsx-runtime --outfile=.extract.mjs && node .extract.mjs
node render.mjs cues cues.json
echo '{"total":28.902}' > meta.json && python3 sfx.py          # → sfx.wav
ffmpeg -i bgm.m4a -i sfx.wav -filter_complex \
  "[0:a]aresample=44100,atrim=start=80.8111:duration=28.902,asetpts=PTS-STARTPTS,afade=t=in:d=0.4,afade=t=out:st=27.9:d=1.0[m];[m][1:a]amix=inputs=2:normalize=0,alimiter=limit=0.95:level=false[a]" \
  -map "[a]" -c:a pcm_s16le mix.wav
node render.mjs video film_noaudio.mp4 30
ffmpeg -i film_noaudio.mp4 -i mix.wav -c:v copy -c:a aac -b:a 256k -shortest theone-film.mp4
```

Preview frames with `node render.mjs stills 1.2,12.468,20 out/`. Opening `film.html` in a browser loops the film silently.

The BGM, the extracted DSH artwork and the rendered video are not committed. The BGM is a third-party track, so check its licence before publishing. The end card states the film is an unofficial community plugin, in line with DSH's brand guidelines.

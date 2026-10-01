# TheOne — vertical film

1080×1920, 30 fps, 25.7 s. Light theme, English only, almost no on-screen text. Every frame is a pure function of `t` in `film.js`; Playwright screenshots each frame and ffmpeg encodes. All sound effects are synthesized by `sfx.py`.

The UI is a replica of the DSH web client built with DSH's own icons, whale mark and wordmark (`extract-icons.tsx` renders them from the `deepseek-harness` sources). The window is laid out at 2.8× resolution with CSS `zoom` and scaled back down, so text stays sharp under the 3D camera. The top 170 px stay background-only for the phone notch.

## Beat map

- BGM: 77 BPM, 4/4, one beat = 0.779 s.
- The BGM drop is at 1:33.279. The film uses the BGM from **83.149 s**, so the drop lands on **10.130 s = 13 beats in**: the frame where The One is clicked.
- Before the drop the BGM is an ambient pad, then 8 beats of silence. Each ↑ key press lands on the grid, so the split-flap sounds carry the rhythm.
- After the drop each bar hits hard on **beats 1, 2¼ and 3**, and every post-drop action lands on those hits (`r(1)`, `r(2.25)`, `r(3)`, …).

| Beats | Shot | Sound |
| --- | --- | --- |
| 0–1.6 | The camera tracks the cursor over the dock; click DSH on beat 1; the window zooms open | Mouse click |
| 2–4.5 | Close-up of the session list. ↑ moves the selection up one session per 8th note; the list follows | Split-flap per session |
| 5–8.4 | The silence: key repeat speeds up to 16th, then 32nd notes | Faster flaps |
| 8.5–9.4 | The motion carries into a blurred rush up the sidebar | Wind |
| 9.4–13 | The One: the UI fades to a warm haze, soft rays, the cursor drifts in | Pad, shimmer, reverse swell |
| **13 (drop)** | **Click → bloom → The One lifts out as a thick 3D key, the UI tilts away** | Click and sub impact |
| r1 / r2¼ / r3 | Layers drop in behind it: router → 9 sessions → history | Layer thocks on the hits |
| r4–r8 | "Kyoto, day 3?" → router `SWAP` → *Trip to Kyoto* lights up → reply comes back | Blips on the hits |
| r8–r12 | "New topic: a cat feeder" → `CREATE` → a new session appears | Sparkle |
| r12–r16 | Old titles fly in and tumble chaotically, then snap into PROJECT A / PROJECT B / TRAVEL / HOME on r13, r14¼, r15, r15½ | Snaps |
| r16–r19 | **The One** · One chat. Every context. · github.com/YunongDai2005/dsh-theone | Shimmer |

## Build

```sh
cd promo
npm install && pip install numpy scipy
git clone --depth 1 https://github.com/deepseek-ai/deepseek-harness.git ../.dsh
npx esbuild extract-icons.tsx --bundle --platform=node --format=esm --jsx=automatic \
  --external:react --external:react-dom --external:react/jsx-runtime --outfile=.extract.mjs && node .extract.mjs
node render.mjs cues cues.json
echo '{"total":25.685}' > meta.json && python3 sfx.py          # → sfx.wav
ffmpeg -i bgm.m4a -i sfx.wav -filter_complex \
  "[0:a]aresample=44100,atrim=start=83.1487:duration=25.685,asetpts=PTS-STARTPTS,afade=t=in:d=0.4,afade=t=out:st=24.7:d=0.98[m];[m][1:a]amix=inputs=2:normalize=0,alimiter=limit=0.95:level=false[a]" \
  -map "[a]" -c:a pcm_s16le mix.wav
node render.mjs video film_noaudio.mp4 30
ffmpeg -i film_noaudio.mp4 -i mix.wav -c:v copy -c:a aac -b:a 256k -shortest theone-film.mp4
```

Preview frames with `node render.mjs stills 1.2,10.13,20 out/`. Opening `film.html` in a browser loops the film silently.

The BGM, the extracted DSH artwork and the rendered video are not committed. The BGM is a third-party track, so check its licence before publishing. The end card states the film is an unofficial community plugin, in line with DSH's brand guidelines.

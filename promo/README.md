# TheOne — vertical film

1080×1920, 30 fps, 35.2 s. Light theme, English only, almost no on-screen text. Every frame is a pure function of `t` in `film.js`; Playwright screenshots each frame and ffmpeg encodes. All sound effects are synthesized by `sfx.py`.

The UI is a replica of the DSH web client built with DSH's own icons, whale mark and wordmark (`extract-icons.tsx` renders them from the `deepseek-harness` sources). The window is laid out at 2.8× resolution with CSS `zoom` and scaled back down, so text stays sharp under the 3D camera. The top 170 px stay background-only for the phone notch.

Video frames are rendered at 3× (`SS=3`) and downsampled with Lanczos, which keeps text sharp on oblique 3D planes. After the drop, The One key carries a screen-space volumetric glow (halo shaped to its projection, soft rays, an anamorphic streak and a light cone down to the router); it flares only on each bar's strongest hit (`r(4k+1)`). The 3D key's face is a pre-rendered 8× bitmap (`mkface.mjs`); whenever the key faces the camera it is swapped for a flat 2D copy fitted to its projected corners, because Chromium caps the raster resolution of 3D layers but not 2D ones. The pre-drop sidebar button, the router and the highlighted session cards use the same screen-space halos, so no glow lies flat on a tilted plane.

## Beat map

- BGM: 77 BPM, 4/4, one beat = 0.779 s.
- The BGM drop is at 1:33.279. The film uses the BGM from **77.694 s** (a 5-bar phrase boundary), so the drop lands on **15.584 s = 20 beats in**: the frame where The One is clicked.
- Before the drop the BGM is an ambient pad, then 8 beats of silence (beats 12–20). Swipes, clicks and the slam all land on the grid.
- After the drop each bar hits hard on **beats 1, 2¼ and 3**, and every post-drop action lands on those hits (`r(1)`, `r(2.25)`, `r(3)`, …).

| Beats | Shot | Sound |
| --- | --- | --- |
| 0–1.6 | The camera tracks the cursor over the dock; click DSH on beat 1; the window opens | Mouse click |
| 2–4 | ~170 sessions. Two trackpad swipes on the beat; the cursor stays still while the list coasts and slows | Swipe brush, one flap per session passing |
| 4–6 | The cursor checks rows in order, opens one and lingers | Hover ticks, click |
| 6–8 | Three harder swipes | More, faster flaps |
| 8–10 | A quicker scan, opens another, lingers | Ticks, click |
| 10–12 | Frantic swipes that stop dead as the silence starts | Rattling flaps |
| 12–13.5 | Camera and cursor shake | Low angry growl |
| 13.5 | Slam: the rows tip over and fall like books off a shelf | Slam, cascade of book thuds |
| 15.25–16.25 | The camera rises to a slight low angle and zooms onto The One | Whoosh |
| 16.25–20 | Warm haze, soft rays; the cursor drifts in | Pad, shimmer, reverse swell |
| **20 (drop)** | **Click → bloom → The One lifts out as a thick 3D key, the UI tilts away** | Click and sub impact |
| r1 / r2¼ / r3 | Layers drop in behind it: router → 9 sessions → history | Layer thocks on the hits |
| r4–r8 | "Kyoto, day 3?" → router `SWAP` → *Trip to Kyoto* lights up → reply comes back | Blips |
| r8–r12 | "New topic: a cat feeder" → `CREATE` → a new session appears | Sparkle |
| r12–r15½ | The history sheet shows four topic slots (PROJECT A / PROJECT B / TRAVEL / HOME); old titles tumble in 3D, then drop into the slots on r13, r14¼, r15, r15½ | Snaps |
| r17 | The four topic cards slide together and square up into a deck | Card slide and taps |
| r17½ | The deck flattens to the key's footprint and takes on its warm slice colours | Soft compress |
| r18¼–r19 | The deck rises and docks under the 3D key on r19, becoming part of its thickness | Rise, docking thock |
| r20–r21 | The key turns face-on, flattens, and the camera pushes into "One" until it blooms | Swoosh |
| r21–r24¾ | **The One** forms out of the light · One chat. Every context. (r22¼) · github.com/YunongDai2005/dsh-theone (r23) | Shimmer |

## Build

```sh
cd promo
npm install && pip install numpy scipy
git clone --depth 1 https://github.com/deepseek-ai/deepseek-harness.git ../.dsh
npx esbuild extract-icons.tsx --bundle --platform=node --format=esm --jsx=automatic \
  --external:react --external:react-dom --external:react/jsx-runtime --outfile=.extract.mjs && node .extract.mjs
node mkface.mjs                  # The One key face as an 8× bitmap (face.png)
node render.mjs cues cues.json
echo '{"total":35.171}' > meta.json && python3 sfx.py          # → sfx.wav
ffmpeg -i bgm.m4a -i sfx.wav -filter_complex \
  "[0:a]aresample=44100,atrim=start=77.6942:duration=35.171,asetpts=PTS-STARTPTS,afade=t=in:d=0.4,afade=t=out:st=34.17:d=1.0[m];[m][1:a]amix=inputs=2:normalize=0,alimiter=limit=0.95:level=false[a]" \
  -map "[a]" -c:a pcm_s16le mix.wav
SS=3 node render.mjs video film_noaudio.mp4 30   # 3× supersampled, Lanczos down to 1080×1920
ffmpeg -i film_noaudio.mp4 -i mix.wav -c:v copy -c:a aac -b:a 256k -shortest theone-film.mp4
```

Render just one section with `START=27.2 END=32.6 SS=2 node render.mjs video part.mp4 30`. Preview frames with `node render.mjs stills 1.2,15.584,25 out/`. Opening `film.html` in a browser loops the film silently.

The BGM, the extracted DSH artwork and the rendered video are not committed. The BGM is a third-party track, so check its licence before publishing. The end card states the film is an unofficial community plugin, in line with DSH's brand guidelines.

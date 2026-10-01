# TheOne — vertical film

1080×2160 (9:18), 60 fps, 38.3 s. Light theme, English only, almost no on-screen text. Every frame is a pure function of `t` in `film.js`; Playwright screenshots each frame and ffmpeg encodes. All sound effects are synthesized by `sfx.py`.

The UI is a replica of the DSH web client built with DSH's own icons, whale mark and wordmark (`extract-icons.tsx` renders them from the `deepseek-harness` sources). The window is laid out at 3.3× resolution with CSS `zoom` and scaled back down, so text stays sharp under the 3D camera. The 1080×1920 design sits in the middle of a 1080×2160 (9:18) stage, so the extra 120 px top and bottom keep the notch, the rounded top corners and the platform UI clear of anything important.

Video frames are rendered at 3× (`SS=3`) and downsampled with Lanczos, which keeps text sharp on oblique 3D planes. After the drop, The One key glows along its real projected outline (the hull of its box corners, rounded and drawn as blurred edge, bloom and haze layers), with the bloom and haze inflated in 3D before projection so their spread is foreshortened like the key itself; plus soft rays, an anamorphic streak, and a routing light that travels level by level, accelerating into each landing, as a wave of rounded rectangles that morphs in 3D from the key's outline into the target's, so every wavefront keeps the angle and perspective of the planes it travels between: key → router on r5 / r9 (the bar's strongest hit), router → session on r6¼ / r10¼; each level flares only when the light lands; it flares only on each bar's strongest hit (`r(4k+1)`). The 3D key's face is a pre-rendered 8× bitmap (`mkface.mjs`); whenever the key faces the camera it is swapped for a flat 2D copy fitted to its projected corners, because Chromium caps the raster resolution of 3D layers but not 2D ones. The pre-drop sidebar button, the router and the highlighted session cards use the same outline-following glow, so no glow is an ellipse or lies flat on a tilted plane.

## Night version

`film.html?theme=dark` renders the night version from the same timeline: DSH's own dark theme for the interface, and the plugin's dark One button (#1d2a37 / #344d64 / #93c8f3). Every warm accent (glows, routing light, key thickness, deck, end logo) maps into the same pale blue. `node build.mjs dark` builds it.

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
| r21–r28¾ | **The One** forms out of the light · One chat. Every context. (r22¼) · GitHub mark + YunongDai2005/dsh-theone (r23); the logo's halo and rays swell on each bar's strongest hit, then a 3-second hold before the fade | Shimmer |

## Build

Save the BGM as `promo/bgm.m4a`, then one command does everything (Windows, macOS or Linux): installs Playwright and Chromium, clones `deepseek-harness` next to the repo and extracts its artwork, builds the key face bitmap, synthesizes the sound effects from the film's own cue list, mixes them with the BGM, renders and muxes.

```sh
cd promo
pip install numpy scipy          # plus Node 18+, ffmpeg and git on PATH
node build.mjs                   # light: 60 fps, 3× supersampled → TheOne-light-9x18-60fps.mp4
node build.mjs dark              # night version                → TheOne-dark-9x18-60fps.mp4
node build.mjs dark 30 1         # quick preview: 30 fps, no supersampling
```

- `WORKERS=n` sets how many browsers render frames in parallel (default: half the CPU cores, up to 8). Every frame is a pure function of `t`, so the output is identical to a single-browser render.
- `GPU=1` renders with the graphics card: full Chromium in new headless mode, with D3D11 on Windows. The log prints the renderer it got; `SwiftShader` there means it fell back to software.
- `CRF` and `PRESET` override the x264 settings (default 16 / slow), e.g. `CRF=28 PRESET=veryfast` for a small preview.
- On Windows PowerShell, set variables first: `$env:GPU=1; $env:WORKERS=8; node build.mjs dark`.

### Faster export

```powershell
npm.cmd run build:fast
# Dark theme:
npm.cmd run build:dark:fast
```

The fast profile keeps 60 fps and 1080×2160 output. It uses GPU browser rendering, `SS=2`, JPEG quality 90, x264 `veryfast` / CRF 18, and up to four browser workers. Its screenshots contain 44% as many pixels as the standard `SS=3` build; reduced supersampling and JPEG quality can soften small text and edges. Output names end in `-fast.mp4`. Speed gains depend on which stage limits the machine; this profile has not been benchmarked.

For AMD hardware encoding, use an FFmpeg build with `h264_amf` and an installed AMD driver:

```powershell
$env:ENCODER = 'h264_amf'
npm.cmd run build:fast
Remove-Item Env:ENCODER
```

This sends video encoding to the AMD encoder. Browser screenshots, JPEG processing, and some scaling or transfers still use the CPU. The AMD defaults are `AMF_QUALITY=balanced`, `QP=20` for I-frames and 22 for P-frames; these replace x264's `CRF` and `PRESET` settings. Lower `QP` improves quality and increases file size. See [AMD's AMF settings](https://github.com/GPUOpen-LibrariesAndSDKs/AMF/wiki/AMF-Encoder-Settings-and-Tuning-in-FFmpeg).

Existing environment settings override the fast profile. An explicit supersampling argument overrides `SS`, for example `node build.mjs dark 60 1 --fast` for native-resolution screenshots. Video rendering pipelines one pending screenshot per worker into FFmpeg in frame order, so workers can start the next frame while FFmpeg consumes the preceding frame.

Before each still or video screenshot, the renderer flushes layout and waits for two animation-frame callbacks with timeline time held fixed. This gives CSS 3D and SVG updates time to paint before capture. It is a mitigation for intermittent missing layers observed in existing exports; corrected exports have not been verified. If the problem persists, compare a section with `WORKERS=1` and then with `GPU=0` to distinguish worker pressure from the hardware rendering path.

`GPU=1` is this project's switch; it selects Playwright's full Chromium channel. The logged renderer identifies a WebGL context and does not prove that every CSS/SVG effect runs on the GPU. See [Playwright's browser modes](https://playwright.dev/docs/browsers#chromium-new-headless-mode).

Render just one section with `START=27.2 END=32.6 SS=2 node render.mjs video part.mp4 30`. Preview frames with `node render.mjs stills 1.2,15.584,25 out/`. Opening `film.html` in a browser loops the film silently.

The BGM, the extracted DSH artwork and the rendered video are not committed. The BGM is a third-party track, so check its licence before publishing. The end card states the film is an unofficial community plugin, in line with DSH's brand guidelines.

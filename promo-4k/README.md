# TheOne — 16:9 4K film

The landscape cut of the TheOne film: 3840×2160, 60 fps, about 51 s. Same story and beat map as the vertical film in `../promo`, re-staged for a 16:9 screen:

- The search shows the whole DSH window: each session the cursor opens fills the chat pane, and none is the right one. Three loops, each more frantic.
- After the click the structure reads left to right: The One key → router → a grid of sessions with one empty slot, which CREATE fills. History sorts into four topic slots in a row.
- The 3D section cuts on the beats: close on the key as a message arrives, over the router as the light lands, beside the cards, a top-down view of the grid filling its empty slot, close on the history slots, and two hero angles on the finished key.
- Then four more requests reach the router at once and fan out to their sessions: one entry point for everything.
- Depth fills the 16:9 frame: a wall of every other conversation behind the window, a cloud of session cards and a dot-grid floor behind the 3D structure, and soft light shafts that swell on the bar's strongest hit.
- A few big words land on the beats ("223 chats.", "Not this one.", "Which one?" falling with the books, "Just one.", "Sorted.").
- The BGM starts at bar -7 (71.46 s), so the click on DSH lands as the bass enters and the click on The One still lands on the drop at 1:33.279. Two bars after the drop are added: a hero orbit around the finished key, then the key turns face-on through the BGM's quiet bar and blooms into the logo on the next strong hit.

## How it is built

- **Remotion** owns the timeline: every frame is a pure function of `t` (`src/lib/timeline.ts`, `src/lib/story.ts`, `src/lib/shots.ts`).
- **DOM** draws the desktop, the DSH window replica (DSH's own icons and wordmark) and the end card.
- **Three.js** draws everything after the click. One camera (`src/lib/camera.ts`) drives both: the DOM window gets the camera as a CSS 3D transform (the math of three's CSS3DRenderer), so the sidebar button and the 3D key line up to the pixel at the hand-off.
- 3D text is SDF vector text (troika), sharp at any angle. Each text holds the frame until it is laid out and redraws the canvas, so no frame is captured with missing text.
- Glow is real bloom on HDR sources (the key's rim, the routing light). By day it is laid over the image in its own hue (additive light vanishes on white); at night it is added as light.

## Run it locally

```sh
cd promo-4k
npm install
pip install numpy scipy            # for the synthesized sound effects; ffmpeg and git on PATH
# save the BGM as promo-4k/bgm.m4a (or reuse promo/bgm.m4a)
node scripts/prepare.mjs           # DSH artwork, fonts, soundtrack (BGM cut + SFX)
npx remotion studio                # live preview with a timeline (uses your GPU)
node scripts/render.mjs            # day:   out/TheOne-light-16x9-4k60.mp4
node scripts/render.mjs dark       # night: out/TheOne-dark-16x9-4k60.mp4
```

`SCALE=1` renders a 1080p preview; `CONCURRENCY=n` sets how many frames render in parallel. After changing cue timings in `src/lib/story.ts`, run `node scripts/prepare.mjs` again to rebuild the soundtrack.

The BGM, DSH's artwork and the rendered films are not committed. The BGM is a third-party track; check its licence before publishing.

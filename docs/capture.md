# Capture runbook: the five storyboards at 1920 × 1080

For the human capture on a GPU machine (Sun 17:00–19:00). Written by Kcap2 after a headless dry run
(results at the end). The storyboards are `web/public/story/*.json`; the code is `web/src/story/`
(`query.ts` reads the parameters, `boot.ts` sets up capture mode, `attach.ts` runs the stories and
exposes `window.__capture`).

## Two ways to capture

| | **A. Frame capture (recommended)** | **B. Screen recording (fallback)** |
|---|---|---|
| URL | `<base>?capture=<id>#/` | `<base>?intro=1#/` (intro), `<base>?demo=1#/` (kiosk) |
| Timing | virtual clock, one fixed 1/60 s step per frame, a frame is drawn only when every tile, the terrain and the relief are loaded: no stutter, no half-loaded tiles, a frame is a pure function of its index (restartable at any frame) | wall clock (rAF): dropped frames, tiles may pop in on a slow network |
| Chrome | none (map only), except where a storyboard reveals the UI (`"ui": "reveal"`) | the loading screen's **Full screen** and **Skip intro** buttons stay in the bottom-right corner for the whole intro (L12) |
| Storyboards | all five | intro and kiosk only (flythrough: the app's Flythrough button, not the storyboard) |
| Needs | Node ≥ 20 and Playwright (`web/node_modules`), ffmpeg | OBS or any screen recorder |

Use A for every storyboard. Use B only if A cannot run on the capture machine, or to get a quick
take of the intro / kiosk while A renders.

## Where to run it

- **Published site** (`https://homeline.vxliu.com/`): deploys from **`main`** only (pages.yml). The
  design work (L10 chase camera, L12 loading screen, storm.json) reaches it only after design is
  promoted to main and the pages run is green. Check before capturing:
  - `curl -s https://homeline.vxliu.com/story/flythrough.json | head` answers 200;
  - for B (intro): the page source contains `id="hl-loading"` (the L12 loading screen);
  - `git log origin/main` contains the design promotion and `gh run list --workflow pages -L 3`
    shows its deploy green.
  The published build is live (`VITE_LIVE=1`): if the API is down the site falls back to the static
  plans and shows the offline label. The storyboards use only static data, so frames are the same.
- **Local `vite preview`** (any commit, e.g. `origin/design`; recommended for the capture):

  ```sh
  git fetch origin && git checkout --detach origin/design
  cd web && npm ci            # once
  npm run build               # static build: VITE_DATA=real, no live layer
  npx vite preview --port 4173 --strictPort
  # base = http://127.0.0.1:4173/
  ```

  `npm run build:live-demo` (live layer on) gives the same storyboard frames; with no API it shows the
  offline label, which is under the hidden chrome in capture mode. Never a dummy build
  (`VITE_DATA=dummy`): the dummy banner stays on top of every frame.

## Settings (both ways)

- Window / viewport **1920 × 1080**, device scale factor **1** (the storyboards declare
  `"size": [1920, 1080]`; capture mode sizes the map to it).
- **Reduced motion off.** Capture mode forces it off itself; for B check the OS setting
  (GNOME: Settings › Accessibility › Reduce animation off; macOS: Accessibility › Display › Reduce
  motion off; Windows: Animation effects on). With reduced motion on, the intro does not play at all
  and the kiosk uses camera cuts.
- **Exaggeration from config**: `config/design.yaml` `exaggeration.default` = **1.0**. Do not touch the
  Exaggeration slider before or during a take; a fresh tab / profile starts at the default (the app
  keeps no browser storage). Capture mode always starts at the default.
- **Full screen**: B only. Press **F** (or the **Full screen** button) on the loading screen; F does
  not skip the intro. **Esc** skips the intro (and leaves full screen), so do not press it during a
  take. F, the button and Esc come with L12 (#147); on a build without it there is no loading screen:
  use F11 and do not press Esc. The kiosk (`?demo=1`) has no loading screen: use the browser's own full screen (F11) before
  loading the URL. A uses no full screen: the recorder sets the viewport.
- Fresh tab per take (B): the intro plays once per page session; `?intro=1` forces it.

## Order and per-storyboard sheet

Capture in this order (most important first; each A take is independent, so a failure does not
block the next).

| # | id | URL (A) | Frames @ 60 fps | Duration | Chrome in the take |
|---|---|---|---|---|---|
| 1 | `video_beat1` | `<base>?capture=video_beat1#/` | 901 | 15 s | none |
| 2 | `intro` | `<base>?capture=intro#/` | 1201 | 20 s | UI fades in from t = 18 s (`ui: reveal`, by design) |
| 3 | `flythrough` | `<base>?capture=flythrough#/` | 5041 | 84 s | none |
| 4 | `storm` | `<base>?capture=storm#/` | 1321 | 22 s | storm panel + banner stay visible (by design, M12) |
| 5 | `kiosk` | `<base>?capture=kiosk#/` | 6241 | 104 s (one loop) | UI from t = 18 s for the rest of the loop (by design) |

`&chrome=1` (A) keeps the UI chrome on for the whole take, if a version with the app around the map is
wanted.

### 1. video_beat1 (15 s): the video beat
Descent onto the pad (Gale caption), the dashed flat circle, the collapse (8.5 s → 11.5 s), the
unknown hatch, the edge labels, the counted headline. Expected: no chrome, caption centred low.

### 2. intro (20 s)
Gale from high above with relief, descent to Mount Sharp's flank (pitch to 55° at 9 s), the pad at 12 s
(walk-back caption), "not flat" collapse 14.5 s → 17.5 s, the UI fades in at 18 s and the camera
returns to the planning view (pitch 0). B: `<base>?intro=1#/`, F on the loading screen, start
recording before loading the URL, cut the recording at the first frame after the loading screen fades.

### 3. flythrough (84 s)
Chase camera 250 m behind / 175 m above the crew marker, route legs (done / coming) and stations drawn,
margin field, clock at 4× until 82 s, then 2 s hold. The thread tooltip rides next to the crew
("Home in … · margin …").

### 4. storm (22 s)
The 20 May 2024 storm on the EVA clock: caption `storm.title`, clock starts at 2 s, the tripwire fires
at about 8.5 s, the dose ring tightens (caption from 9 s), clock stops at 20 s. `?capture=storm`
switches the storm on by itself (no extra parameter).

### 5. kiosk (104 s per loop)
The intro (0–18 s), at 18 s the UI is revealed and the camera eases down into the chase (clock paused
at 0 until 20 s), then the flythrough at 4× until 102 s. Same pictures as 2 + 3 with the UI on; capture
it last, or skip it if time runs out. B: `<base>?demo=1#/` loops until any input.

## Recorder (A)

Save as `web/record.mjs` (outside git; it is not part of the app) and run from `web/`:

```sh
node record.mjs http://127.0.0.1:4173/ video_beat1        # -> video_beat1.mp4
node record.mjs http://127.0.0.1:4173/ flythrough 2       # every 2nd frame -> 30 fps, half the time
```

```js
// record.mjs <base> <id> [every=1]: frame capture through window.__capture, piped into ffmpeg
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'

const [base, id, everyArg] = process.argv.slice(2)
const every = Number(everyArg ?? 1)
const browser = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization'] })
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, reducedMotion: 'no-preference' })
const page = await ctx.newPage()
page.setDefaultTimeout(0)
page.on('console', (m) => m.type() === 'error' && console.error('console:', m.text()))
page.on('pageerror', (e) => console.error('pageerror:', e.message))
await page.goto(`${base}?capture=${id}#/`)
await page.waitForFunction(() => window.__capture)
const { frames, fps } = await page.evaluate(() => ({ frames: window.__capture.frames, fps: window.__capture.fps }))
await page.evaluate(() => window.__capture.ready)                       // frame 0 drawn
const ff = spawn('ffmpeg', ['-y', '-f', 'image2pipe', '-framerate', String(fps / every), '-i', '-',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-pix_fmt', 'yuv420p', `${id}.mp4`], { stdio: ['pipe', 'inherit', 'inherit'] })
const t0 = Date.now()
for (let f = 0; f < frames; f += every) {
  if (f > 0) await page.evaluate((n) => window.__capture.seek(n), f)   // deterministic: frame = f(index)
  ff.stdin.write(await page.screenshot({ type: 'png' }))
  if (f % 300 === 0) console.log(`${id} frame ${f}/${frames} ${((Date.now() - t0) / 1000).toFixed(0)} s`)
}
ff.stdin.end()
await new Promise((r) => ff.on('close', r))
await browser.close()
```

Notes:
- `headless: false` uses the GPU on a desktop session. Keep the browser window on screen and
  unobstructed (an occluded window may throttle). Playwright's own Chromium is fine
  (`npx playwright install chromium` once); on NixOS pass `executablePath: process.env.HL_CHROMIUM`.
- Each frame waits for its tiles, so the first frames of a take (cold cache) are slow; later frames
  reuse the HTTP cache. Expect frame 0 in a few seconds on a GPU (3.5–42 s in the software-GL dry run).
- Sanity check while it runs: `html[data-story-frame]` counts up; a frame with all-black output means
  the GPU context was lost: restart the take.
- PNG frames instead of a pipe: `page.screenshot({ path: \`${id}/f${String(f).padStart(5, '0')}.png\` })`,
  then `ffmpeg -framerate 60 -i ${id}/f%05d.png -c:v libx264 -crf 14 -pix_fmt yuv420p ${id}.mp4`
  (≈ 2 MB a frame: 12 GB for the kiosk).
- Time budget: 14 705 frames for all five at 60 fps. At ~0.3 s a frame on a GPU that is ~75 min;
  measure the first 300 frames of `video_beat1` and switch the long ones (flythrough, kiosk) to
  `every = 2` if the rate is worse.

## Known issues (not blockers; frames are usable)

- **Flythrough frame 0, "No way home known from here"**: at the pad (t = 0) the thread tooltip next to
  the crew reads "No way home known from here" (the pointer field has no move at the pad cell;
  pre-existing thread behaviour, visible now that the crew is centred, notes/L10.md). From frame 1 on it
  reads "Home in … · margin …". The same text comes back on the **last** frames, when the crew is back
  on the pad (flythrough t ≈ 82–84 s, kiosk t ≈ 102–104 s). Fallback: trim the first ~0.5 s and the
  final hold of the take in the edit.
- **Stretched-pixel streaks at the DEM edge**: where the relief / DEM coverage ends the terrain repeats
  its edge texels as streaks. At 1920 × 1080 the opening Gale shot of `intro` and `kiosk` is wider than
  the `relief_low` coverage: at t = 0 there is an empty strip on the left (≈ 200 px) and on the right
  (≈ 420 px) with vertical streaks at its edge (x ≈ 1460–1500) and one stray streak at the top right;
  at t = 3 s still a ≈ 300 px strip on the right; from t ≈ 6 s the frame is filled (a thin streak at the
  top edge remains until the descent). `video_beat1` starts lower (pitch 30) and is clear. Data
  rendering, out of scope for the freeze. Fallback: start the intro edit at ~5 s, or crop / scale the
  first seconds; the B take (live, full viewport) shows the same.
- **Storm: empty strip on the right**: the storm camera (PAD, 7 km, pitch 0) shows the map beyond the
  basemap's east edge as a flat dark-brown strip, x ≈ 1640–1920 px (about 15 % of the frame), for the
  whole 22 s (also in the 12:30 dry run). Not black; the storm panel, banner and dose ring are clear of
  it. Fallback: crop to the left 85 % and scale, or accept it. A camera change (lower `alt_m`) would also
  crop the ring and the south stations, so it is the design owner's call, not changed here.
- **Kiosk / intro chrome after 18 s**: by design (`ui: reveal`): zoom buttons, 2D/3D + exaggeration,
  compass, Flythrough / Storm replay / Flat vs real, scale bar, the headline. In the kiosk's flythrough
  part the top bar's right-hand icons (search, panel) peek out under the compass at the top right. For a
  chrome-free kiosk, use the intro (0–18 s) + flythrough takes instead.
- **B only: loading-screen buttons**: Full screen / Skip intro stay on screen during the live intro.
  Crop them out (bottom-right corner) or use A.
- **Software GL** (no GPU): a frame takes 1–40 s (frame 0 of the flythrough 42 s; 40–150 s under
  heavy machine load); a full take is not feasible. Use a GPU machine.

## Fallbacks

| Problem | Do this |
|---|---|
| `window.__capture` never appears | the storyboard id is wrong (lowercase, `[a-z0-9_-]`), or `story/<id>.json` is 404 on that base (published site behind design): use the local preview |
| A frame takes minutes | tiles from a slow network: run against the local preview; or the GPU is not used (check `chrome://gpu` in that browser) |
| Recorder crashes mid-take | `seek(n)` is deterministic: restart from the last written frame (loop from `f = n`) and concatenate |
| Headed GPU browser not available | B (screen recording) for intro and kiosk; for the flythrough, the app's **Flythrough** button on the planning map (3D, same chase camera, route + stations on) |
| Published site not promoted yet | local `vite preview` of `origin/design` (above) |
| Intro does not play (B) | reduced motion is on, or `?intro=0` / the intro already ran in this tab: fresh tab with `?intro=1` |

## Dry run (Kcap2, Sun 14:39–14:57)

Build: `origin/design` d558bb5 (L10) + a local merge of `origin/ws16-map-visuals-L12` (#147 was not
on design yet; the merge has one conflict in `story/attach.ts` `settle()`, where L10 and L12 carry the
same Kcap fix: L12's loop kept, L10's `probe()` kept). Two builds: static (`vite build`) and live-mock
(`VITE_LIVE=1 VITE_LIVE_MOCK=1 VITE_SIM_EXPORT=all`), served by `vite preview`. Headless Chromium
(SwiftShader) at 1920 × 1080, scale 1, reduced motion off; per storyboard frame 0 (`ready`), one
`step()`, 1–2 seeks, the last frame. Checks: reaches the end (`done`), console errors / warnings and
failed requests, near-black share of the frame, `#hl-loading` and chrome
(`.hl-ui`, `.maplibregl-control-container`, `.console-panel`) visible.

| id | frames sampled (static) | reaches end | console / failed req. | black frames | loading screen after t = 0 | chrome after t = 0 | verdict |
|---|---|---|---|---|---|---|---|
| `video_beat1` | 0, 1, 540, 900 | yes (900, 15 s) | 0 / 0 | none | never present | none | **ready** |
| `intro` | 0, 1, 180, 360, 540, 720, 1140, 1200 | yes (1200, 20 s) | 0 / 0 | none | never present | from t = 18 s (reveal, by design) | **ready**, opening shot has DEM-edge strips until ~5 s |
| `flythrough` | 0, 1, 2400, 5040 | yes (5040, 84 s) | 0 / 0 | none | never present | none; crew marker at the centre (±20 px), route / stations / crew drawn | **ready**, "No way home known" at frame 0 and the final hold |
| `storm` | 0, 1, 600, 1320 | yes (1320, 22 s) | 0 / 0 | none | never present | storm panel + banner only (by design) | **ready**, empty strip on the right 15 % |
| `kiosk` | 0, 1, 1140, 3000, 6240 | yes (6240, 104 s) | 0 / 0 | none | never present | from t = 18 s (by design); top-bar icons under the compass | **ready** (lowest priority) |

Live-mock build: the same five storyboards (frame 0, 1, last) reach their end with 0 console messages
and 0 failed requests; frames match the static build within a 10 % colour fuzz (0 px differ, except
377 px of chrome on the kiosk's last frame and < 1 px on the storm's).

Live path (B), static build: `?intro=1#/`: the loading screen is up at 1.5 s, the intro starts
(`html[data-hl-intro=playing]`) and the loading panel fades out; the **Full screen** and **Skip intro**
buttons stay visible bottom-right for the whole intro; 0 console messages. `?demo=1#/`: no loading
screen, the kiosk starts at once with chrome hidden.

Software-GL seek times (machine load ~20–45): frame 0 3.5–47 s (flythrough 42–47 s), later frames
0.3–33 s.

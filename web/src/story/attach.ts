// WS16 task 10 (M10): story mode on the planning map (DESIGN U6), loaded lazily by ConsoleMap only
// when a story runs (story/query.ts). Three runs:
//   intro    intro.json once, live (rAF); any key, click, wheel or touch skips at once (U6: skip delay 0 s)
//   demo     kiosk.json in a loop, live; any input exits and leaves the app as it was
//   capture  ?capture=<id>: the storyboard at its fixed frame step under virtual time (vtime.ts), no
//            wall clock; a recorder drives it through window.__capture (see notes/M10.md)
import type { Map as MlMap } from 'maplibre-gl'
import type { ConsoleMap } from '../map/consoleMap'
import { loadLabels } from '../map/labels/layer'
import { loadFlightPath } from '../map/flythrough/route'
import { missionClock, ui } from '../state'
import { end as endPlayer, start as startPlayer } from '../state/activity'
import { Director, type DirectorState } from './director'
import { storyParams, storyRequest, type StoryRequest } from './query'
import { StoryStage, type ChromePolicy } from './stage'
import { FOLLOW_TARGET, loadStoryboard, type Storyboard } from './storyboard'
import { setVirtualTime, virtualTimeInstalled } from './vtime'
import { basemapSources } from '../map/basemap'
import { demSource, parseTerrainTiles } from '../map/terrain/tiles'
import { exaggeration } from '../map/terrain/state'
import { data } from '../data/loader'
import { DATA_MODE, dataUrl } from '../env'
import { CHASE, ELEVATION_FACTOR, FIRST_FRAME_MAX_MS, WARMUP_MAX_MS } from './config'
import { after, descentTiles, mapIdle, prefetch, storyPoses, until, type TileSet } from './warm'
import { introOver, introSkipRequested, loadingDone, onIntroSkip, setLoadProgress, STAGE } from './loading'

const INPUTS = ['keydown', 'pointerdown', 'wheel', 'touchstart'] as const

async function makeDirector(sb: Storyboard, reduced: boolean): Promise<Director> {
  const labels = (await loadLabels()) ?? []
  const needsFollow = sb.steps.some((s) => s.camera?.target === FOLLOW_TARGET)
  const fp = needsFollow ? await loadFlightPath() : null
  return new Director(sb, {
    targets: (code) => {
      const l = labels.find((x) => x.code === code)
      return l ? [l.lon, l.lat] : null
    },
    follow: fp ? (t) => fp.poseAt(t) : undefined,
    tMax: missionClock.tMax,
    reduced,
    cutS: CHASE.reducedCutS,
  })
}

/** Remove ?demo / ?capture / ?intro from the address (replace) once the run is over. */
function dropStoryParams(): void {
  const u = new URL(location.href)
  for (const k of ['demo', 'capture', 'intro', 'chrome']) u.searchParams.delete(k)
  const [path, q] = u.hash.split('?')
  if (q) {
    const h = new URLSearchParams(q)
    for (const k of ['demo', 'capture', 'intro', 'chrome']) h.delete(k)
    u.hash = h.toString() ? `${path}?${h}` : path
  }
  history.replaceState(history.state, '', u.toString())
}

/** Live playback with the rAF clock; resolves 'end' or 'cancel'. */
function playLive(stage: StoryStage, d: Director, o: { loop: boolean; signal: { stopped: boolean } }): Promise<'end' | 'cancel'> {
  return new Promise((resolve) => {
    let t0 = -1
    let raf = 0
    const finish = (why: 'end' | 'cancel'): void => {
      cancelAnimationFrame(raf)
      for (const ev of INPUTS) window.removeEventListener(ev, onInput, true)
      resolve(why)
    }
    const onInput = (): void => {
      o.signal.stopped = true
      finish('cancel')
    }
    for (const ev of INPUTS) window.addEventListener(ev, onInput, { capture: true, passive: true })
    const frame = (now: number): void => {
      if (o.signal.stopped) return finish('cancel')
      if (t0 < 0) t0 = now
      const st = d.stateAt((now - t0) / 1000)
      stage.apply(st)
      if (st.done) {
        if (!o.loop) return finish('end')
        t0 = now
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
  })
}

/** Tile sets the descent draws: the relief_low and terrain DEMs and the HiRISE basemap (each optional). */
async function descentTileSets(): Promise<TileSet[]> {
  const json = async (p: string): Promise<unknown> => {
    const r = await fetch(dataUrl(p, DATA_MODE))
    const ct = r.headers.get('content-type') ?? ''
    return r.ok && (!ct || ct.includes('json')) ? r.json() : null
  }
  const dem = async (p: string): Promise<TileSet[]> => {
    const raw = await json(p).catch(() => null)
    if (!raw) return []
    const s = demSource(parseTerrainTiles(raw), (x) => x)
    return [{ tiles: s.tiles ?? [], minzoom: s.minzoom ?? 0, maxzoom: s.maxzoom ?? 22, bounds: s.bounds as TileSet['bounds'], tileSize: s.tileSize ?? 256 }]
  }
  const base = async (): Promise<TileSet[]> => {
    const tj = await data()
      .optional(() => data().tilejson())
      .catch(() => null)
    return tj ? basemapSources(tj, (x) => x).map((b) => ({ tiles: b.tiles, minzoom: b.minzoom, maxzoom: b.maxzoom, bounds: b.bounds, tileSize: b.tileSize })) : []
  }
  return (await Promise.all([dem('terrain_low/tiles.json'), dem('terrain/tiles.json'), base()])).flat()
}

/**
 * M10c warm-up before a live story's t = 0 (warm.ts): every layer the storyboard shows is drawn once
 * under a cover (programs link, the field uploads its textures), the tiles along the camera
 * path go into the HTTP cache, then frame 0 is applied and its tiles awaited. Bounded by
 * WARMUP_MAX_MS + FIRST_FRAME_MAX_MS; input during it skips the story as usual.
 */
async function warmUp(stage: StoryStage, d: Director, signal: { stopped: boolean }): Promise<void> {
  const map = stage.map
  const s0 = d.stateAt(0)
  const all: Record<string, boolean> = {}
  for (const st of d.sb.steps) for (const [id, on] of Object.entries(st.layers ?? {})) if (on) all[id] = true
  stage.setCanvasHidden(true)
  stage.apply({ ...s0, layers: { ...s0.layers, ...all }, camera: null })
  const c = map.getContainer()
  const url = (p: string): string => dataUrl(p, DATA_MODE)
  const terrainSettled = (): boolean => !['loading', 'off'].includes(c.getAttribute('data-terrain') ?? 'off') || !all.terrain
  const fieldSettled = (): boolean => c.getAttribute('data-bands-render') === 'gpu' || !all.homeline
  // L12: the loading screen's bar follows the warm-up's real loads (tiles fetched, terrain, field)
  let tiles = { done: 0, total: 0 }
  const report = (): void => {
    const parts = [tiles.total ? tiles.done / tiles.total : 0, terrainSettled() ? 1 : 0, fieldSettled() ? 1 : 0]
    setLoadProgress(STAGE.warm + (STAGE.frame0 - STAGE.warm) * (parts.reduce((a, b) => a + b, 0) / parts.length))
  }
  void descentTileSets()
    .then((sets) => {
      const urls = descentTiles(storyPoses(d), sets, { width: c.clientWidth, height: c.clientHeight }, { factor: ELEVATION_FACTOR, exaggeration: exaggeration() }, url)
      tiles = { done: 0, total: urls.length }
      return prefetch(urls, { onEach: () => ((tiles.done += 1), report()) })
    })
    .catch(() => 0)
  const end = performance.now() + WARMUP_MAX_MS
  const left = (): number => Math.max(0, end - performance.now())
  await until(map, () => (report(), signal.stopped || (terrainSettled() && fieldSettled())), left())
  await Promise.race([stage.pending, after(left())])
  if (!signal.stopped) await mapIdle(map, left())
  if (signal.stopped) return
  setLoadProgress(STAGE.frame0)
  stage.apply(s0)
  const end0 = performance.now() + FIRST_FRAME_MAX_MS
  await Promise.race([stage.pending, after(FIRST_FRAME_MAX_MS)])
  await mapIdle(map, Math.max(0, end0 - performance.now()))
  stage.setCanvasHidden(false)
}

export interface CaptureApi {
  id: string
  fps: number
  size: [number, number]
  frames: number
  frame: number
  done: boolean
  /** frame 0 is applied and drawn */
  ready: Promise<void>
  /** advance one fixed frame step, apply, wait until drawn; resolves with the new frame */
  step(): Promise<{ frame: number; t: number; done: boolean }>
  /** jump to frame n (deterministic: a frame is a pure function of its index) */
  seek(n: number): Promise<{ frame: number; t: number; done: boolean }>
  state(): DirectorState
  /** L10: what the current frame draws: route / crew layer visibility and the crew marker on screen (tests, dry runs) */
  probe(): CaptureProbe
}

export interface CaptureProbe {
  /** layout visibility of the route legs (done / coming), the stations and the crew marker layers */
  layers: Record<string, string | null>
  /** the crew marker as rendered on this frame, in CSS px of the map canvas; null when not drawn */
  crewPx: [number, number] | null
  /** the map canvas size, CSS px */
  size: [number, number]
}

/** L10: the route, station and crew layers of the current frame and where the crew marker is drawn. */
export function probeMap(map: ConsoleMap['map']): CaptureProbe {
  const layers: Record<string, string | null> = {}
  for (const id of ['route-done', 'route-coming', 'station-rings', 'crew-dot', 'thread-line']) layers[id] = map.getLayer(id) ? ((map.getLayoutProperty(id, 'visibility') as string | undefined) ?? 'visible') : null
  const c = map.getCanvas()
  const size: [number, number] = [c.clientWidth, c.clientHeight]
  const hit = map.getLayer('crew-dot') ? map.queryRenderedFeatures({ layers: ['crew-dot'] }) : []
  const g = hit[0]?.geometry
  const crewPx = g && g.type === 'Point' ? (() => {
    const p = map.project(g.coordinates as [number, number])
    return [p.x, p.y] as [number, number]
  })() : null
  return { layers, crewPx, size }
}

declare global {
  interface Window {
    __capture?: CaptureApi
  }
}

const nextFrame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()))

/** settle() gives up after this many renders (or 50 ms waits) and takes the frame as it is. */
export const SETTLE_MAX_RENDERS = 400

/** The map's style, GeoJSON updates and every in-view tile are loaded, and the 3D terrain is not loading. */
export function settled(map: Pick<MlMap, 'isStyleLoaded' | 'areTilesLoaded' | 'getContainer'>): boolean {
  return !!map.isStyleLoaded() && map.areTilesLoaded() && map.getContainer().getAttribute('data-terrain') !== 'loading'
}

/** Wait until the map has drawn the current state with every tile, terrain and relief loaded. */
export async function settle(stage: Pick<StoryStage, 'map' | 'pending'>): Promise<void> {
  const map = stage.map
  await stage.pending
  let renders = 0
  const counted = (): void => void renders++
  map.on('render', counted)
  try {
    for (let i = 0; i < SETTLE_MAX_RENDERS; i++) {
      await new Promise<void>((r) => {
        const onRender = (): void => {
          clearTimeout(to)
          r()
        }
        const to = setTimeout(() => {
          map.off('render', onRender)
          r()
        }, 50)
        map.once('render', onRender)
        map.triggerRepaint()
      })
      // Not map.loaded(): the station pulse (map furniture) sets a paint property on every animation
      // frame, which keeps the map's style and sources flagged dirty for good, so loaded() never held
      // and every frame ran into the cap twice (~40 s a frame in SwiftShader, notes/Kcap.md). One
      // render after apply() has updated the sources for the new camera; then the style (sources,
      // GeoJSON updates, images) and every in-view tile being loaded means the frame is drawn. L10 found
      // the same for paint transitions and the zoom cross-fade, which run on the clock capture freezes
      // (8.5 min for frame 0 in software GL, notes/L10.md).
      if (renders > 0 && map.isStyleLoaded() && map.areTilesLoaded() && map.getContainer().getAttribute('data-terrain') !== 'loading') break // = settled(map)
    }
  } finally {
    map.off('render', counted)
  }
  await nextFrame()
  await nextFrame()
}

function runCapture(stage: StoryStage, d: Director, sb: Storyboard): CaptureApi {
  let frame = 0
  const go = async (n: number): Promise<{ frame: number; t: number; done: boolean }> => {
    frame = Math.max(0, Math.min(d.frames - 1, n))
    const t = d.frameTime(frame)
    setVirtualTime(t * 1000)
    stage.apply(d.stateAtFrame(frame))
    await settle(stage)
    // a 2D/3D switch or a terrain load may have moved the pitch limit or the ground: apply again
    stage.apply(d.stateAtFrame(frame))
    await settle(stage)
    api.frame = frame
    api.done = frame >= d.frames - 1
    document.documentElement.dataset.storyFrame = String(frame)
    return { frame, t, done: api.done }
  }
  const api: CaptureApi = {
    id: sb.id,
    fps: sb.fps,
    size: sb.size,
    frames: d.frames,
    frame: 0,
    done: false,
    ready: document.fonts.ready.then(() => go(0)).then(() => undefined),
    step: () => go(frame + 1),
    seek: (n) => go(n),
    state: () => d.stateAtFrame(frame),
    probe: () => probeMap(stage.map),
  }
  return api
}

/**
 * L13b (L12 <-> L13 hook, notes/L13.md): a played-out intro ends in Plan's default view (3D unless
 * ?view=2d, the low-fps fallback or the viewer's choice says otherwise), eased. P4a: a skipped (or
 * failed) intro lands there too, at once: StoryStage.restore() puts back the camera saved when the
 * story began, usually before the 3D terrain had loaded, so untilted. The 2D/3D view itself is the
 * same either way (restore() puts back the view planView() chose). Other stories: null (they restore).
 */
export function introLanding(kind: NonNullable<StoryRequest>['kind'], why: 'end' | 'cancel'): { animate: boolean } | null {
  return kind === 'intro' ? { animate: why === 'end' } : null
}

/** Start the story the page asks for, if any; returns a stop function. */
export function attachStory(cmap: ConsoleMap, req: StoryRequest = storyRequest(storyParams(location.search, location.hash), { reduced: ui.reducedMotion.peek(), introSeen: ui.introSeen.peek(), legacy: false })): () => void {
  const signal = { stopped: false }
  // L12: the viewer skipped from the loading screen before the story got here
  if (!req || (req.kind === 'intro' && introSkipRequested())) {
    loadingDone()
    if (req) introOver() // D132: a bare address lands on the Mission Planer once the intro is over
    return () => undefined
  }
  if (req.kind === 'intro') ui.introSeen.value = true // in memory: once per page session (no browser storage)
  let stage: StoryStage | null = null
  // P4a: the intro lands once at Plan's default view (introLanding); `null` = never (another player owns the camera)
  let landed = false
  const land = (why: 'end' | 'cancel' | null): void => {
    if (landed) return
    landed = true
    const o = why && introLanding(req.kind, why)
    if (o) cmap.applyDefaultView(o)
  }
  // L12: 'Skip intro' on the loading screen stops the story wherever it is (loading, warm-up, playing)
  let skipped = (): void => undefined
  const onSkip = new Promise<void>((r) => (skipped = r))
  const skip = (): void => {
    signal.stopped = true
    skipped()
  }
  const unSkip = req.kind === 'capture' ? () => undefined : onIntroSkip(skip)
  void (async () => {
    const id = req.kind === 'capture' ? req.id : req.kind === 'demo' ? 'kiosk' : 'intro'
    const reduced = req.kind === 'capture' ? false : ui.reducedMotion.peek()
    setLoadProgress(STAGE.map)
    const [sb] = await Promise.all([loadStoryboard(id), cmap.whenReady()])
    const d = await makeDirector(sb, reduced)
    if (signal.stopped) return loadingDone()
    setLoadProgress(STAGE.warm)
    const chrome: ChromePolicy = req.kind === 'capture' ? (req.chrome ? 'shown' : 'hidden') : 'story'
    stage = new StoryStage(cmap, chrome)
    if (req.kind === 'capture') {
      if (!virtualTimeInstalled()) console.warn('capture without virtual time: frames follow the wall clock')
      window.__capture = runCapture(stage, d, sb)
      return
    }
    // L7c: the intro (and the kiosk loop) is a player of the activity store (state/activity.ts): another
    // player, an edit or a mode switch stops it, the app restored at once (before that player starts)
    const st = stage
    // P4a: stopped by an edit, a mode switch or another player: the default view (tilt) at once, before
    // that player starts and moves the camera itself; refused at the start (another player is already
    // on): no landing, that player has the camera
    const stopStory = (): void => {
      signal.stopped = true
      st.restore(false)
      land('cancel')
    }
    st.onRestored = () => endPlayer('intro', stopStory)
    if (!startPlayer('intro', stopStory).ok) {
      land(null)
      stopStory()
    }
    // input during the warm-up skips the story like input during it: the app is restored in the
    // input's own microtasks, before its click lands (the click acts on the restored app, D9)
    for (const ev of INPUTS) window.addEventListener(ev, skip, { capture: true, passive: true })
    await Promise.race([warmUp(stage, d, signal), onSkip]).finally(() => {
      for (const ev of INPUTS) window.removeEventListener(ev, skip, true)
    })
    if (signal.stopped) {
      stage.restore(false)
      stage = null
      land('cancel')
      if (req.kind === 'demo') dropStoryParams()
      return
    }
    const why = await playLive(stage, d, { loop: req.kind === 'demo', signal })
    stage.restore(why === 'end')
    stage = null
    land(why)
    if (req.kind === 'demo') dropStoryParams()
  })()
    .catch((e) => {
      console.warn('story unavailable:', e)
      const restored = !!stage
      stage?.restore(false)
      stage = null
      if (restored) land('cancel')
    })
    .finally(() => {
      unSkip()
      if (req.kind !== 'capture') loadingDone() // L12: never leave the loading screen up
      if (req.kind === 'intro') introOver() // D132: ended, skipped or failed
    })
  return () => {
    signal.stopped = true
    skipped()
    if (req.kind === 'capture') delete window.__capture
  }
}

// WS16 task 10 (M10): story mode on the planning map (DESIGN U6), loaded lazily by ConsoleMap only
// when a story runs (story/query.ts). Three runs:
//   intro    intro.json once, live (rAF); any key, click, wheel or touch skips at once (U6: skip delay 0 s)
//   demo     kiosk.json in a loop, live; any input exits and leaves the app as it was
//   capture  ?capture=<id>: the storyboard at its fixed frame step under virtual time (vtime.ts), no
//            wall clock; a recorder drives it through window.__capture (see notes/M10.md)
import type { ConsoleMap } from '../map/consoleMap'
import { loadLabels } from '../map/labels/layer'
import { loadFlightPath } from '../map/flythrough/route'
import { missionClock, ui } from '../state'
import { Director, type DirectorState } from './director'
import { storyParams, storyRequest, type StoryRequest } from './query'
import { StoryStage, type ChromePolicy } from './stage'
import { FOLLOW_TARGET, loadStoryboard, type Storyboard } from './storyboard'
import { setVirtualTime, virtualTimeInstalled } from './vtime'

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
}

declare global {
  interface Window {
    __capture?: CaptureApi
  }
}

const nextFrame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()))

/** Wait until the map has drawn the current state with every tile, terrain and relief loaded. */
async function settle(stage: StoryStage): Promise<void> {
  const map = stage.map
  await stage.pending
  for (let i = 0; i < 400; i++) {
    await new Promise<void>((r) => {
      const to = setTimeout(r, 50)
      map.once('render', () => {
        clearTimeout(to)
        r()
      })
      map.triggerRepaint()
    })
    const terrain = map.getContainer().getAttribute('data-terrain')
    if (map.loaded() && map.areTilesLoaded() && terrain !== 'loading') break
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
  }
  return api
}

/** Start the story the page asks for, if any; returns a stop function. */
export function attachStory(cmap: ConsoleMap, req: StoryRequest = storyRequest(storyParams(location.search, location.hash), { reduced: ui.reducedMotion.peek(), introSeen: ui.introSeen.peek(), legacy: false })): () => void {
  const signal = { stopped: false }
  if (!req) return () => undefined
  if (req.kind === 'intro') ui.introSeen.value = true // in memory: once per page session (no browser storage)
  let stage: StoryStage | null = null
  void (async () => {
    const id = req.kind === 'capture' ? req.id : req.kind === 'demo' ? 'kiosk' : 'intro'
    const reduced = req.kind === 'capture' ? false : ui.reducedMotion.peek()
    const [sb] = await Promise.all([loadStoryboard(id), cmap.whenReady()])
    const d = await makeDirector(sb, reduced)
    if (signal.stopped) return
    const chrome: ChromePolicy = req.kind === 'capture' ? (req.chrome ? 'shown' : 'hidden') : 'story'
    stage = new StoryStage(cmap, chrome)
    if (req.kind === 'capture') {
      if (!virtualTimeInstalled()) console.warn('capture without virtual time: frames follow the wall clock')
      window.__capture = runCapture(stage, d, sb)
      return
    }
    const why = await playLive(stage, d, { loop: req.kind === 'demo', signal })
    stage.restore(why === 'end')
    stage = null
    if (req.kind === 'demo') dropStoryParams()
  })().catch((e) => {
    console.warn('story unavailable:', e)
    stage?.restore(false)
    stage = null
  })
  return () => {
    signal.stopped = true
    if (req.kind === 'capture') delete window.__capture
  }
}

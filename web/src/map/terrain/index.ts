// WS16 task 8 (M8): U1 wiring on the planning map — small and GL-free; the 3D code (terrain.ts) loads
// with import() the first time 3D is turned on, and so do terrain/tiles.json and the tiles.
//
//   ui.view '3d'   -> terrain + relief shading, tilt and rotation unlocked, camera to the 3D pitch
//   ui.view '2d'   -> terrain off, pitch 0, maxPitch 0, rotation locked; relief shading stays once loaded
//   no WebGL2 / below 30 fps for 3 s in 3D -> flat with relief shading + one-line notice, ui.view '2d'
//   ui.exaggeration -> setTerrain exaggeration (1 = true shape: the 1.878 factor is in the tiles)
//   mission clock  -> relief light = sun azimuth at the whole simulated minute (conditions/clock.json)
//   ui.reducedMotion -> no camera animation
// L13 (team lead 12:54, D111): on the Plan map (opts.planView) the controller opens in the view
// state/view.ts resolves (?view=, else the viewer's remembered choice, else plan_view.default: 3D) at
// plan_view.pitch_deg / bearing_deg with the route framed (opts.frame); the low-frame-rate fallback
// (performance.fps_3d_min, D38) shows a dismissible note, never under ?view=3d.
import type { Map as MlMap } from 'maplibre-gl'
import { DATA_MODE, dataUrl } from '../../env'
import { data } from '../../data/loader'
import { parseClockSun, type ClockFile, type SunData } from '../../hud/sun'
import { effect, mission, ui } from '../../state'
import { noteFallback, planView, viewOverride, type View } from '../../state/view'
import { TOKENS } from '../../ui/tokens'
import { COPY_PENDING, t } from './config'
import { TerrainControl, TerrainNotice, TERRAIN_TRUST } from './controls'
import { FpsWatch } from './fps'
import { exaggeration, reliefAzimuth, reliefMinute, setView } from './state'
import { parseTerrainTiles, type TerrainTiles } from './tiles'
import type { TerrainHandle } from './terrain'

export { TerrainControl, TERRAIN_TRUST } from './controls'
export { chooseToggle, chooseView, clampExaggeration, exaggeration, setExaggeration, setView, toggleView } from './state'

export interface TerrainControllerOptions {
  /** L13: this is the Plan map: open in state/view.ts planView() (3D by default) */
  planView?: boolean
  /**
   * L13: put the camera at Plan mode's open pose (plan_view pitch/bearing) with the route in view
   * (ConsoleMap.frameRoute); called when the opening 3D view is on, and by openPlanView().
   */
  frame?: (animate: boolean) => void
}

export type TerrainState = 'off' | 'loading' | '3d' | 'flat' | 'unavailable'

/** Field layer handle shape this module drapes (field/layer.ts FieldLayerHandle). */
interface FieldLike {
  readonly id: string
  update(p: never): void
  setData(fd: never): void
}

/** A story (intro, kiosk, capture) is playing: it owns the camera (StoryStage sets html[data-story]). */
function storyOn(): boolean {
  try {
    return typeof document !== 'undefined' && !!document.documentElement?.dataset?.story
  } catch {
    return false
  }
}

function webgl2(): boolean {
  try {
    return typeof document !== 'undefined' && !!document.createElement('canvas').getContext('webgl2')
  } catch {
    return false
  }
}

export class TerrainController {
  private readonly control = new TerrainControl()
  private readonly notice: TerrainNotice
  private readonly fps = new FpsWatch()
  private readonly stops: (() => void)[] = []
  private handle: TerrainHandle | null = null
  private loading: Promise<TerrainHandle | null> | null = null
  private tiles: TerrainTiles | null = null
  private sun: SunData | null = null
  private sunRequested = false
  private lightMinute: number | null = null
  private field: FieldLike | null = null
  private state: TerrainState = 'off'
  private seq = 0
  /** L13: the next 3D-on is Plan mode opening (no tilt animation; the open pose and framing follow) */
  private opening: { animate: boolean } | null = null
  /** L13: ?view= on the page (a forced 3D keeps the fallback off) */
  private readonly forced: View | null
  private readonly opts: TerrainControllerOptions

  private readonly map: MlMap
  /** layer the relief shading sits under (it goes above the basemap) */
  private readonly beforeId: string

  constructor(map: MlMap, beforeId: string, opts: TerrainControllerOptions = {}) {
    this.map = map
    this.beforeId = beforeId
    this.opts = opts
    this.forced = opts.planView ? viewOverride() : null
    map.addControl(this.control, 'top-left')
    this.notice = new TerrainNotice(map.getContainer())
    this.setState('off')
    if (opts.planView) {
      // before the effect below runs: its first apply() is the opening
      this.opening = { animate: false }
      setView(planView())
    }
    this.stops.push(
      effect(() => {
        const v = ui.view.value
        void this.apply(v)
      }),
      effect(() => {
        const x = exaggeration()
        this.handle?.setExaggeration(x)
        map.getContainer().setAttribute('data-terrain-exaggeration', String(x))
      }),
      effect(() => {
        const m = reliefMinute(mission.clock.t.value)
        if (m !== this.lightMinute) {
          this.lightMinute = m
          this.applyLight()
        }
      }),
    )
    map.on('render', this.onRender)
  }

  /** The field layer to drape while 3D is on (null when the polygons are shown). */
  attachField(h: FieldLike | null): void {
    if (h && h !== this.field) {
      // redraw the draped tiles whenever the field changes (terrainTileRevision)
      const bump = (): void => {
        if (this.state === '3d') void import('./terrain').then((m) => m.bumpDrape(this.map, h.id))
      }
      const upd = h.update.bind(h)
      const set = h.setData.bind(h)
      ;(h as { update: (p: never) => void }).update = (p) => {
        upd(p)
        bump()
      }
      ;(h as { setData: (fd: never) => void }).setData = (fd) => {
        set(fd)
        bump()
      }
    }
    this.field = h
    if (h) this.handle?.drapeField(h.id)
  }

  private setState(s: TerrainState): void {
    this.state = s
    const c = this.map.getContainer()
    c.setAttribute('data-terrain', s)
    if (s === 'off' || s === 'unavailable') return
    // trust-chip hook on the terrain layer group: measured DEM, the factor in the tiles noted
    c.setAttribute('data-trust-terrain', TERRAIN_TRUST.chip)
    c.setAttribute('data-trust-terrain-source', TERRAIN_TRUST.source)
    if (this.tiles) c.setAttribute('data-trust-terrain-factor', String(this.tiles.factor))
  }

  private async load(): Promise<TerrainHandle | null> {
    this.loading ??= (async () => {
      const res = await fetch(dataUrl('terrain/tiles.json', DATA_MODE))
      if (!res.ok) return null
      const ct = res.headers.get('content-type') ?? ''
      if (ct && !ct.includes('json')) return null // dev server SPA fallback
      this.tiles = parseTerrainTiles(await res.json())
      const mod = await import('./terrain')
      this.handle = mod.addTerrain(this.map, this.tiles, (p) => dataUrl(p, DATA_MODE), this.beforeId, { exaggeration: exaggeration(), azimuth: this.azimuth() })
      if (this.field) this.handle.drapeField(this.field.id)
      this.requestSun()
      return this.handle
    })().catch((e) => {
      console.warn('3D terrain unavailable:', e)
      return null
    })
    return this.loading
  }

  /**
   * L13 end-of-intro hook (L12 calls it through ConsoleMap.applyDefaultView): Plan mode's default view
   * (planView()), and in 3D the open pose with the route in view. `animate` eases (never under reduced motion).
   */
  openPlanView({ animate = false }: { animate?: boolean } = {}): void {
    const v = planView()
    const anim = animate && !ui.reducedMotion.peek()
    if (v === '3d' && ui.view.peek() === '3d' && this.state === '3d') {
      this.opts.frame?.(anim)
      return
    }
    this.opening = v === '3d' ? { animate: anim } : null
    setView(v)
  }

  /** L13: 3D is on and drawing (the Plan map frames the route in 3D only then: maxPitch is lifted). */
  get is3d(): boolean {
    return this.state === '3d'
  }

  private async apply(v: '2d' | '3d'): Promise<void> {
    const seq = ++this.seq
    const opening = v === '3d' ? this.opening : null
    this.opening = null
    const animate = !ui.reducedMotion.peek() && (!opening || opening.animate)
    if (v === '2d') {
      if (this.state === '3d') {
        this.handle?.setTerrainOn(false, { animate })
        this.setState('flat')
      } else this.flatten(animate)
      if (this.state === 'loading') this.setState(this.handle ? 'flat' : 'off')
      return
    }
    // 3D asked for: a fresh try (a previous slow-fps fallback is forgotten)
    this.fps.rearm()
    this.notice.show(null)
    if (!webgl2()) return this.fallback('webgl')
    this.setState('loading')
    this.notice.show(t('states.loading.terrain3d'))
    const h = await this.load()
    if (seq !== this.seq) return
    this.notice.show(null)
    if (!h) {
      this.control.setUnavailable(COPY_PENDING.noTiles)
      this.setState('unavailable')
      this.notice.show(COPY_PENDING.noTiles)
      ui.view.value = '2d'
      return
    }
    h.setTerrainOn(true, { animate })
    this.setState('3d')
    // L13: the opening pose and framing; never while a story moves the camera (it restores its own)
    if (opening && !storyOn()) this.opts.frame?.(animate)
  }

  /**
   * L13 (RR1 on T1): 2D is always north up and untilted. A camera that something else left tilted or
   * turned while the map was already flat (a move still running at the fallback, a flythrough frame)
   * goes back to pitch 0, bearing 0, and the tilt stays locked (maxPitch 0).
   */
  private flatten(animate: boolean): void {
    const m = this.map as Partial<MlMap>
    const pitch = m.getPitch?.() ?? 0
    const bearing = m.getBearing?.() ?? 0
    if (pitch === 0 && bearing === 0) return
    if (storyOn()) return // a story sets its own camera (and StoryStage.restore() puts the app's back)
    const target = { pitch: 0, bearing: 0 }
    if (animate) {
      this.map.easeTo({ ...target, duration: TOKENS.motion.cameraMs[0] })
      this.map.once('moveend', () => this.state !== '3d' && this.map.setMaxPitch(0))
    } else {
      this.map.jumpTo(target)
      this.map.setMaxPitch(0)
    }
  }

  /** Flat map with relief shading and a one-line notice (DESIGN U1 item 6). */
  private async fallback(why: 'webgl' | 'slow3d'): Promise<void> {
    // L13 (RR1): stop any camera move still running (focus ease, preset tilt), so nothing tilts or
    // turns the flat map after the cut to pitch 0 / bearing 0
    ;(this.map as Partial<MlMap>).stop?.()
    this.handle?.setTerrainOn(false, { animate: false })
    this.flatten(false)
    this.setState('flat')
    // L13: the low-frame-rate note is short and dismissible, and names the way back (T)
    if (why === 'slow3d') {
      noteFallback()
      this.notice.show(COPY_PENDING.slow3dNote, { dismissible: true })
    } else this.notice.show(t('states.error.webgl'))
    this.map.getContainer().setAttribute('data-terrain-fallback', why)
    // the toggle shows 2D; apply('2d') finds the state flat and does nothing more
    if (ui.view.peek() !== '2d') ui.view.value = '2d'
    if (!this.handle && !(await this.load())) this.setState('unavailable')
  }

  private readonly onRender = (): void => {
    if (this.state !== '3d' || this.forced === '3d') return // L13: ?view=3d forces 3D
    if (this.fps.frame(performance.now()) === 'tripped') void this.fallback('slow3d')
  }

  private azimuth(): number | null {
    return reliefAzimuth(this.sun, mission.clock.t.peek())
  }

  private applyLight(): void {
    this.handle?.setLightAzimuth(this.azimuth())
    const az = this.azimuth()
    this.map.getContainer().setAttribute('data-terrain-light-az', az === null ? 'default' : az.toFixed(1))
  }

  private requestSun(): void {
    if (this.sunRequested) return
    this.sunRequested = true
    void data()
      .optional(() => data().clock())
      .then((c) => {
        this.sun = c ? parseClockSun(c as unknown as ClockFile) : null
        this.applyLight()
      })
      .catch(() => undefined)
  }

  destroy(): void {
    for (const s of this.stops) s()
    this.map.off('render', this.onRender)
    this.notice.destroy()
    this.map.removeControl(this.control)
    this.handle?.remove()
  }
}

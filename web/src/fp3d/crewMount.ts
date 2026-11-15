// WS17 task 2 (U8): mounts the crew pair (crew.ts) on the same per-frame hook as K1's cameras
// (view.ts ViewOptions.onCamera, /tmp/hl-design/notes/K1-hook.patch). Three.js-free: the crew
// chunk (crew.ts + Three.js shapes) is imported on the first 3D frame that carries the scene, so
// nothing here reaches the 2D pages or the slot chunk.
//
// Use (once R approves the hook): index.ts mount(): `const cams = installCrew(installCameras(cfg))`
// and view.ts passes `scene` and `route` in the onCamera frame (K2 addendum to the K1 patch,
// /tmp/hl-design/notes/K2-hook-addendum.patch). A frame without them leaves the cameras exactly as
// K1 ships them and shows no figures (WS17 fallback "No figures: chase camera and thread only").
import type { CameraHook, CameraHookFrame, CameraLike } from './cameras'
import type { Crew, CrewRoute } from './crew'

/** The scene as WS8's view holds it (THREE.Scene satisfies this). */
export interface SceneLike {
  add(...objects: never[]): unknown
}

/** K1's onCamera frame, plus the scene and route the crew needs (K2 hook addendum). */
export interface CrewSceneFrame extends CameraHookFrame {
  scene?: SceneLike
  route?: CrewRoute
}

type CrewModule = Pick<typeof import('./crew'), 'createCrew'>

export interface CrewOptions {
  /** the crew chunk (default: the lazy import of crew.ts) */
  load?: () => Promise<CrewModule>
  reducedMotion?: () => boolean
  /**
   * Figures on? Default: off under `?fp3d-probe` (WS8's F20 skyline probe renders the scene with
   * an override material from the route points: a figure there would count as terrain).
   */
  enabled?: () => boolean
}

const notProbe = () => typeof location === 'undefined' || !new URLSearchParams(location.search).has('fp3d-probe')

function scenePosition(camera: CameraLike): { x: number; y: number; z: number } | undefined {
  const p = (camera as { position?: { x?: unknown; y?: unknown; z?: unknown } }).position
  return p && typeof p.x === 'number' && typeof p.y === 'number' && typeof p.z === 'number' ? (p as { x: number; y: number; z: number }) : undefined
}

/**
 * Wrap K1's camera hook so the same per-frame call also places and animates the crew pair. The
 * cameras run first (unchanged); the crew then reads the final camera to hide the leader when the
 * camera is its eye (first person).
 */
export function installCrew<H extends CameraHook>(hook: H, opts: CrewOptions = {}): H {
  const load = opts.load ?? (() => import('./crew'))
  const enabled = (opts.enabled ?? notProbe)()
  let crew: Crew | null = null
  let loading = false
  let disposed = false
  return {
    ...hook,
    onCamera(camera: CameraLike, f: CrewSceneFrame) {
      hook.onCamera(camera, f)
      if (disposed || !enabled || !f.scene || !f.route) return
      if (crew) {
        const pos = scenePosition(camera)
        crew.update({ t: f.t, dtMs: f.dtMs, route: f.route, terrain: f.terrain, anchor: f.anchor, camera: pos ? { position: pos } : undefined })
        return
      }
      if (loading) return
      loading = true
      const scene = f.scene
      load().then(
        (mod) => {
          if (disposed) return
          crew = mod.createCrew({ reducedMotion: opts.reducedMotion })
          scene.add(crew.group as never)
        },
        (e: unknown) => console.warn('[fp3d] crew figures not loaded; scene without figures', e),
      )
    },
    dispose() {
      disposed = true
      crew?.dispose()
      crew = null
      hook.dispose()
    },
  }
}

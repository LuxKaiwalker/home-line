// The Three.js scene of the 3D first-person replay (F20). Loaded lazily from index.ts so the 2D
// pages never pay for Three.js. Terrain/path/clock logic lives in the pure modules next to it.
import * as THREE from 'three'
import { PlaybackClock } from '../hud/clock'
import type { Fp3dConfig } from './config'
import type { FallbackReason } from './fallback'
import { codecOf, decodeHeights, farOrigin, gunzipIfNeeded, parseIndex, type Fp3dChunk, type Fp3dIndex } from './format'
import { FpsWatchdog } from './fps'
import { parseEqc, xyToLonLat, type Eqc } from './geo'
import { createSky, hazeDensity, rgb, ringGeometry, withCurvature } from './look'
import { buildRoute, type RoutePath, type TimelineEvent } from './path'
import { parseRing, type RingCurtain } from './ring'
import { daylightFactor, formatLmst, parseClockSun, sunAt, sunDirection, type SunTrack } from './sun'
import { Terrain, cameraPosition, farMesh, nearChunkMesh, type Anchor, type MeshArrays } from './terrain'

/** F19 position object (same shape the WS7 HUD reads). */
export interface Fp3dPosition {
  lon: number
  lat: number
  sigma_m: number
  source: 'playback'
  t_eva_min: number
}

export interface ViewOptions {
  dataUrl: (path: string) => string
  cfg: Fp3dConfig
  scenario: string
  /** WS7's playback clock (F18) when shared with another view; default: a new one, playing. */
  clock?: PlaybackClock
  onPosition?: (p: Fp3dPosition) => void
  onFallback: (reason: FallbackReason, detail?: string) => void
}

export interface ViewHandle {
  dispose(): void
  /** Eye height above the drawn terrain at the current camera position (m). */
  eyeAboveTerrain(): number
  /**
   * Skyline as rendered by the GPU from (x, y) at eye height (analysis CRS): the scene is drawn
   * white on black (no sky, no haze) at headings covering 360 deg and the first terrain pixel of
   * every column is converted back to azimuth/elevation. For the F20 acceptance check in a real
   * browser (web/src/fp3d/check/skyline_probe.mjs); null until the scene runs.
   */
  probeSkyline?(x: number, y: number): { azDeg: number[]; elDeg: number[] } | null
}

interface Loaded {
  index: Fp3dIndex
  terrain: Terrain
  route: RoutePath
  eqc: Eqc
  textures: Map<string, HTMLImageElement>
  ring: RingCurtain | null
  sun: SunTrack | null
  bytes: number
}

const css = (el: HTMLElement, s: string) => {
  el.style.cssText = s
  return el
}

function div(cls: string, style: string, text = ''): HTMLDivElement {
  const d = document.createElement('div')
  d.className = cls
  d.textContent = text
  return css(d, style) as HTMLDivElement
}

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>): Promise<void> {
  let next = 0
  const worker = async () => {
    while (next < items.length) await fn(items[next++])
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, worker))
}

async function loadImage(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    return img
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function loadAll(
  opts: ViewOptions,
  signal: AbortSignal,
  progress: (done: number, total: number, bytes: number, expected: number | null) => void,
): Promise<Loaded> {
  let bytes = 0
  // Count what crossed the network: a server may send the .gz with Content-Encoding: gzip, so
  // the body we read is already decoded. Resource Timing's encodedBodySize is the wire size.
  const wireSize = (r: Response, decoded: number): number => {
    const e = performance.getEntriesByName(r.url).at(-1) as PerformanceResourceTiming | undefined
    return e && e.encodedBodySize > 0 ? e.encodedBodySize : decoded
  }
  const get = async (path: string): Promise<Response> => {
    const r = await fetch(opts.dataUrl(path), { signal })
    if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`)
    return r
  }
  const getBuf = async (path: string) => {
    const r = await get(path)
    const b = await r.arrayBuffer()
    bytes += wireSize(r, b.byteLength)
    return b
  }
  const getJson = async (path: string) => {
    const b = await getBuf(path)
    return JSON.parse(new TextDecoder().decode(b)) as unknown
  }

  const index = parseIndex(await getJson('fp3d/index.json'))
  const eqc = parseEqc(index.chunk_grid.crs)
  const routeFc = (await getJson(`route_${opts.scenario}.geojson`)) as Parameters<typeof buildRoute>[0]
  let timeline: TimelineEvent[] | null = null
  try {
    timeline = (await getJson(`timeline_${opts.scenario}.json`)) as TimelineEvent[]
  } catch (e) {
    if (signal.aborted) throw e
    timeline = null // leg times then come from the route properties alone
  }
  const route = buildRoute(routeFc, timeline, eqc, opts.cfg.lookAheadM)
  // WS4's Mars24 sun series (conditions/clock.json); absent in the dummy tree -> labelled placeholder
  let sun: SunTrack | null = null
  try {
    sun = parseClockSun(await getJson('conditions/clock.json'))
  } catch (e) {
    if (signal.aborted) throw e
    sun = null
  }
  let ring: RingCurtain | null = null
  if (index.horizon_ring) {
    try {
      const [west, north] = farOrigin(index)
      const square = { west, north, size: index.far.width * index.far.res_m }
      ring = parseRing(await getJson(index.horizon_ring), eqc, square, {
        skirtDeg: opts.cfg.ring.skirtDeg,
        maxDistanceRatio: opts.cfg.ring.maxDistanceRatio,
      })
    } catch (e) {
      if (signal.aborted) throw e
      ring = null // optional: the mesh still draws the skyline inside the terrain extent
    }
  }

  const chunks = index.chunk_grid.chunks
  const total = 1 + chunks.length + chunks.filter((c) => c.tex).length
  let done = 0
  // keep a Resource Timing entry for every file we fetch (the default buffer holds 250)
  performance.setResourceTimingBufferSize(performance.getEntriesByType('resource').length + total)
  const expected = index.download_bytes ?? null
  progress(done, total, bytes, expected)
  const farBuf = await gunzipIfNeeded(await getBuf(index.far.file))
  const codec = codecOf(index)
  const terrain = new Terrain(index, decodeHeights(farBuf, index.far.width, index.far.height, codec))
  progress(++done, total, bytes, expected)

  const P = index.chunk_grid.chunk_px
  const textures = new Map<string, HTMLImageElement>()
  await pool<Fp3dChunk>(chunks, opts.cfg.loaderConcurrency, async (ch) => {
    const buf = await gunzipIfNeeded(await getBuf(ch.file))
    terrain.setChunk(ch.i, ch.j, decodeHeights(buf, P, P, codec))
    progress(++done, total, bytes, expected)
    if (ch.tex) {
      const r = await get(ch.tex)
      const blob = await r.blob()
      bytes += wireSize(r, blob.size)
      textures.set(`${ch.i}_${ch.j}`, await loadImage(blob))
      progress(++done, total, bytes, expected)
    }
  })
  return { index, terrain, route, eqc, textures, ring, sun, bytes }
}

function geometry(m: MeshArrays): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3))
  g.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3))
  if (m.uvs) g.setAttribute('uv', new THREE.BufferAttribute(m.uvs, 2))
  g.setIndex(new THREE.BufferAttribute(m.index, 1))
  g.computeBoundingSphere()
  return g
}


export async function startView(container: HTMLElement, opts: ViewOptions): Promise<ViewHandle> {
  const cfg = opts.cfg
  const abort = new AbortController()
  const disposables: { dispose(): void }[] = []
  let raf = 0
  let disposed = false
  let renderer: THREE.WebGLRenderer | null = null
  let resizeObs: ResizeObserver | null = null
  let eyeAgl = Number.NaN

  const root = div(
    'fp3d',
    'position:relative;width:100%;height:100%;min-height:420px;overflow:hidden;background:#000;color:#fff;font:13px/1.35 system-ui,sans-serif',
  )
  root.dataset.state = 'loading'
  container.append(root)

  const dispose = () => {
    if (disposed) return
    disposed = true
    abort.abort()
    cancelAnimationFrame(raf)
    resizeObs?.disconnect()
    for (const d of disposables) d.dispose()
    if (renderer) {
      renderer.dispose()
      renderer.forceContextLoss()
    }
    root.remove()
  }
  const fail = (reason: FallbackReason, detail?: string) => {
    if (disposed) return
    dispose()
    opts.onFallback(reason, detail)
  }

  // ---- loading screen ---------------------------------------------------------------------
  const loading = div(
    'fp3d-loading',
    'position:absolute;inset:0;display:flex;flex-direction:column;gap:.6em;align-items:center;justify-content:center;background:#1b130e',
  )
  const loadText = div('', '', 'Loading 3D terrain…')
  const barOuter = div('', 'width:16em;height:6px;background:#3a2a20;border-radius:3px;overflow:hidden')
  const bar = div('', 'width:0;height:100%;background:#d6aa8c')
  barOuter.append(bar)
  loading.append(loadText, barOuter, div('', 'opacity:.7', cfg.simulatedLabel))
  root.append(loading)
  const mb = (b: number) => (b / 1e6).toFixed(1)

  let data: Loaded
  try {
    data = await loadAll(opts, abort.signal, (done, total, bytes, expected) => {
      bar.style.width = `${(100 * done) / Math.max(1, total)}%`
      loadText.textContent = `Loading 3D terrain · ${done} / ${total} files · ${mb(bytes)} MB${
        expected ? ` of ${mb(expected)} MB` : ''
      }`
    })
  } catch (e) {
    if (!disposed) fail('load-error', e instanceof Error ? e.message : String(e))
    return { dispose, eyeAboveTerrain: () => eyeAgl }
  }
  if (disposed) return { dispose, eyeAboveTerrain: () => eyeAgl }

  const { index, terrain, route, eqc } = data
  const start = route.poseAt(route.startMin)
  const anchor: Anchor = { x: start.x, y: start.y, h: terrain.heightAt(start.x, start.y) }

  // ---- renderer and scene -------------------------------------------------------------------
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
  } catch (e) {
    fail('no-webgl2', e instanceof Error ? e.message : String(e))
    return { dispose, eyeAboveTerrain: () => eyeAgl }
  }
  renderer.setPixelRatio(window.devicePixelRatio)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  const canvas = renderer.domElement
  css(canvas, 'display:block;width:100%;height:100%')
  root.prepend(canvas)

  // Two passes: (1) sky dome + far-skyline ring (camera with a long far plane), (2) clear depth,
  // terrain with distance haze. Every terrain/ring vertex gets the curvature drop d^2 / 2R.
  renderer.autoClear = false
  const R = cfg.marsRadiusM
  const extent = index.far.width * index.far.res_m
  const ringFar = Math.max(extent * Math.SQRT2, ...(data.ring?.segments.flat().map((p) => p.d) ?? [0])) + extent * Math.SQRT2
  const bg = new THREE.Scene()
  const sky = createSky(cfg, ringFar * 0.9)
  bg.add(sky.mesh)
  disposables.push(sky)
  bg.fog = new THREE.FogExp2(sky.horizon.clone(), hazeDensity(cfg.ring.hazeHalfM))

  const scene = new THREE.Scene()
  scene.fog = new THREE.FogExp2(sky.horizon.clone(), hazeDensity(cfg.sky.hazeHalfM))
  const ambient = new THREE.AmbientLight(0xffffff, cfg.ambientIntensity)
  scene.add(ambient)
  const sunLight = new THREE.DirectionalLight(0xffffff, cfg.sunIntensity)
  scene.add(sunLight)
  const sunVec = new THREE.Vector3()
  const setSun = (t: number) => {
    const s = data.sun ? sunAt(data.sun, t) : { ...cfg.placeholderSun, lmstH: Number.NaN }
    sunVec.set(...sunDirection(s.azDeg, s.elDeg))
    const b = daylightFactor(s.elDeg, cfg.sky.nightSunElDeg, cfg.sky.nightFloor)
    sunLight.position.copy(sunVec)
    sunLight.intensity = s.elDeg > 0 ? cfg.sunIntensity : 0
    ambient.intensity = cfg.ambientIntensity * b
    sky.update(camera, sunVec, b)
    ;(scene.fog as THREE.FogExp2).color.copy(sky.horizon)
    ;(bg.fog as THREE.FogExp2).color.copy(sky.horizon)
    return s
  }

  const ground = rgb(cfg.groundRgb)
  const farMat = withCurvature(
    new THREE.MeshLambertMaterial({
      color: ground,
      polygonOffset: true,
      polygonOffsetFactor: cfg.farPolygonOffset[0],
      polygonOffsetUnits: cfg.farPolygonOffset[1],
    }),
    R,
  )
  const farGeo = geometry(farMesh(terrain, anchor, 1, true))
  scene.add(new THREE.Mesh(farGeo, farMat))
  disposables.push(farGeo, farMat)

  const plainMat = withCurvature(new THREE.MeshLambertMaterial({ color: ground }), R)
  disposables.push(plainMat)
  const aniso = renderer.capabilities.getMaxAnisotropy()
  for (const ch of index.chunk_grid.chunks) {
    if (!terrain.hasChunk(ch.i, ch.j)) continue
    const g = geometry(nearChunkMesh(terrain, ch.i, ch.j, anchor))
    disposables.push(g)
    let mat: THREE.Material = plainMat
    const img = data.textures.get(`${ch.i}_${ch.j}`)
    if (img) {
      const tex = new THREE.Texture(img)
      tex.colorSpace = THREE.SRGBColorSpace
      tex.anisotropy = aniso
      tex.needsUpdate = true
      mat = withCurvature(new THREE.MeshLambertMaterial({ map: tex }), R)
      disposables.push(tex, mat)
    }
    scene.add(new THREE.Mesh(g, mat))
  }

  const camera = new THREE.PerspectiveCamera(cfg.fovDeg, 1, cfg.nearClipM, extent * Math.SQRT2)
  const bgCamera = new THREE.PerspectiveCamera(cfg.fovDeg, 1, Math.max(cfg.nearClipM, extent * 0.25), ringFar)
  const ringGeo = data.ring ? ringGeometry(data.ring, anchor) : null
  if (ringGeo) {
    const ringMat = withCurvature(new THREE.MeshBasicMaterial({ color: ground.clone().multiplyScalar(0.8), side: THREE.DoubleSide }), R)
    bg.add(new THREE.Mesh(ringGeo, ringMat))
    disposables.push(ringGeo, ringMat)
  }
  root.dataset.ring = data.ring?.note ?? 'no skyline ring'

  // ---- overlays -----------------------------------------------------------------------------
  loading.remove()
  const top = div(
    'fp3d-top',
    'position:absolute;left:0;right:0;top:0;display:flex;justify-content:flex-start;gap:1.5em;padding:.5em .8em;background:linear-gradient(#0009,#0000);pointer-events:none',
  )
  const label = div('fp3d-label', '', cfg.simulatedLabel + (index.dummy ? ' · DUMMY DATA' : ''))
  const meter = div('fp3d-fps', 'font-variant-numeric:tabular-nums', '… fps')
  top.append(label, meter)
  const caption = div(
    'fp3d-caption',
    'position:absolute;left:.8em;bottom:3.4em;padding:.2em .5em;background:#0008;border-radius:3px',
    cfg.resolutionCaption,
  )
  const resCaption = document.createElement('span')
  resCaption.textContent = cfg.resolutionCaption
  const sunCaption = document.createElement('span')
  caption.replaceChildren(resCaption, document.createTextNode(' · '), sunCaption)
  root.append(top, caption)

  // the F18 playback clock (WS7 web/src/hud/clock.ts): EVA minutes 0 .. crew.yaml eva_h * 60
  const clock = opts.clock ?? new PlaybackClock(cfg.evaMin, cfg.playbackSpeeds, cfg.defaultSpeed)
  if (!opts.clock) clock.play()
  const tText = div('fp3d-t', 'font-variant-numeric:tabular-nums;min-width:6.5em')
  const bar2 = div(
    'fp3d-controls',
    'position:absolute;left:0;right:0;bottom:0;display:flex;gap:.6em;align-items:center;padding:.5em .8em;background:#000a;z-index:3',
  )
  const play = document.createElement('button')
  const syncPlay = () => (play.textContent = clock.playing ? 'Pause' : 'Play')
  play.onclick = () => {
    clock.toggle()
    syncPlay()
  }
  syncPlay()
  const speed = document.createElement('select')
  for (const s of cfg.playbackSpeeds) {
    const o = document.createElement('option')
    o.value = String(s)
    o.textContent = `${s}×`
    o.selected = s === clock.speed
    speed.append(o)
  }
  speed.onchange = () => clock.setSpeed(Number(speed.value))
  const scrub = document.createElement('input')
  scrub.type = 'range'
  scrub.min = '0'
  scrub.max = String(clock.tMax)
  scrub.step = 'any'
  scrub.style.flex = '1'
  scrub.oninput = () => clock.seek(Number(scrub.value))
  bar2.append(play, speed, scrub, tText)
  root.append(bar2)
  const syncUi = () => {
    if (document.activeElement !== scrub) scrub.value = String(clock.t)
    syncPlay()
  }

  const resize = () => {
    const w = root.clientWidth || 1
    const h = root.clientHeight || 1
    renderer!.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    bgCamera.aspect = w / h
    bgCamera.updateProjectionMatrix()
  }
  resize()
  resizeObs = new ResizeObserver(resize)
  resizeObs.observe(root)

  // ---- frame loop -----------------------------------------------------------------------------
  const watchdog = new FpsWatchdog({
    belowFps: cfg.fpsFallbackBelow,
    windowS: cfg.fallbackWindowS,
    warmupS: cfg.fallbackWarmupS,
  })
  const dir = new THREE.Vector3()
  // a hidden tab pauses requestAnimationFrame: tell the watchdog so the gap is not "low fps".
  // ?fp3d-probe (headless geometry check) disables the low-fps fallback: SwiftShader is slow.
  const probeMode = new URLSearchParams(location.search).has('fp3d-probe')
  let resumed = false
  const onVis = () => {
    if (document.visibilityState === 'visible') resumed = true
  }
  document.addEventListener('visibilitychange', onVis)
  disposables.push({ dispose: () => document.removeEventListener('visibilitychange', onVis) })
  let last = performance.now()
  let lastPosT = Number.NaN
  root.dataset.state = 'running'

  const frame = (now: number) => {
    if (disposed) return
    raf = requestAnimationFrame(frame)
    clock.tick(now - last)
    last = now
    const t = clock.t
    const pose = route.poseAt(t)
    camera.position.set(...cameraPosition(terrain, anchor, pose.x, pose.y, cfg.eyeHeightM))
    const hd = (pose.headingDeg * Math.PI) / 180
    dir.set(Math.sin(hd), 0, -Math.cos(hd)).add(camera.position)
    camera.lookAt(dir)
    bgCamera.position.copy(camera.position)
    bgCamera.quaternion.copy(camera.quaternion)
    const sn = setSun(t)
    sunCaption.textContent = data.sun
      ? `Sun: Mars24 · LMST ${formatLmst(sn.lmstH)}${sn.elDeg <= 0 ? ' · below horizon' : ''}`
      : cfg.placeholderSun.label
    renderer!.clear()
    renderer!.render(bg, bgCamera)
    renderer!.clearDepth()
    renderer!.render(scene, camera)
    eyeAgl = camera.position.y + anchor.h - terrain.heightAt(pose.x, pose.y)
    root.dataset.eyeAgl = eyeAgl.toFixed(3)
    tText.textContent = `T+${t.toFixed(1)} min${pose.dwellAt ? ` · at ${pose.dwellAt}` : ''}`
    syncUi()
    if (opts.onPosition && t !== lastPosT) {
      lastPosT = t
      const [lon, lat] = xyToLonLat(eqc, pose.x, pose.y)
      opts.onPosition({ lon, lat, sigma_m: 0, source: 'playback', t_eva_min: t })
    }
    const s = watchdog.frame(now, resumed)
    resumed = false
    if (s.fps !== null) {
      meter.textContent = `${Math.round(s.fps)} fps · ${mb(data.bytes)} MB`
      root.dataset.fps = s.fps.toFixed(1)
    }
    if (s.fallback && !probeMode) fail('low-fps', `under ${cfg.fpsFallbackBelow} fps for ${cfg.fallbackWindowS} s`)
  }
  raf = requestAnimationFrame(frame)

  const probeMat = withCurvature(new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }), R)
  disposables.push(probeMat)
  const probeSkyline = (x: number, y: number) => {
    if (disposed || !renderer) return null
    const r = renderer
    const size = r.getDrawingBufferSize(new THREE.Vector2())
    const W = size.x
    const H = size.y
    const fov0 = camera.fov
    for (const c of [camera, bgCamera]) {
      c.fov = cfg.skylineCheck.probeFovDeg
      c.updateProjectionMatrix()
    }
    const f = H / 2 / Math.tan((camera.fov * Math.PI) / 360)
    const hfov = 2 * Math.atan(W / 2 / f)
    const steps = Math.ceil((2 * Math.PI) / (hfov * 0.9))
    const px = new Uint8Array(W * H * 4)
    const saved = { fog: scene.fog, bgFog: bg.fog, sky: sky.mesh.visible, clear: r.getClearColor(new THREE.Color()) }
    scene.overrideMaterial = probeMat
    bg.overrideMaterial = probeMat
    scene.fog = null
    bg.fog = null
    sky.mesh.visible = false
    r.setClearColor(0x000000, 1)
    const azDeg: number[] = []
    const elDeg: number[] = []
    const pos = cameraPosition(terrain, anchor, x, y, cfg.eyeHeightM)
    const look = new THREE.Vector3()
    try {
      for (let k = 0; k < steps; k++) {
        const h = (k * 2 * Math.PI) / steps
        camera.position.set(...pos)
        look.set(Math.sin(h), 0, -Math.cos(h)).add(camera.position)
        camera.lookAt(look)
        camera.updateMatrixWorld()
        bgCamera.position.copy(camera.position)
        bgCamera.quaternion.copy(camera.quaternion)
        bgCamera.updateMatrixWorld()
        r.clear()
        r.render(bg, bgCamera)
        r.clearDepth()
        r.render(scene, camera)
        const gl = r.getContext()
        gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px)
        for (let c = 0; c < W; c++) {
          let top = -1 // first terrain pixel from the top (readPixels rows run bottom-up)
          for (let row = 0; row < H; row++) {
            if (px[4 * ((H - 1 - row) * W + c)] >= 128) {
              top = row
              break
            }
          }
          // no terrain, or terrain already in the top row (skyline above the frame: at wide
          // azimuth offsets the top row looks lower) -> another heading covers this azimuth
          if (top <= 0) continue
          const xc = c + 0.5 - W / 2
          const yc = H / 2 - top // boundary between sky row top-1 and terrain row top
          azDeg.push(((((h + Math.atan2(xc, f)) * 180) / Math.PI) % 360 + 360) % 360)
          elDeg.push((Math.atan2(yc, Math.hypot(xc, f)) * 180) / Math.PI)
        }
      }
    } finally {
      for (const c of [camera, bgCamera]) {
        c.fov = fov0
        c.updateProjectionMatrix()
      }
      scene.overrideMaterial = null
      bg.overrideMaterial = null
      scene.fog = saved.fog
      bg.fog = saved.bgFog
      sky.mesh.visible = saved.sky
      r.setClearColor(saved.clear, 1)
    }
    return { azDeg, elDeg }
  }
  if (probeMode) {
    ;(window as unknown as { __fp3dProbe?: typeof probeSkyline }).__fp3dProbe = probeSkyline
  }

  return { dispose, eyeAboveTerrain: () => eyeAgl, probeSkyline }
}

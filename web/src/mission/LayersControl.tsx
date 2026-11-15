// "Layers" panel (top right of the Mission Planer map): overlays on top of any map type.
//   - Slope: WS1's cell slope (fields/shared/slope.png) in classes from config/site.yaml (slope.ts)
//   - Curiosity: the rover's real traverse and drive ends inside the map area, live from NASA;
//     a click on a drive end opens the Mastcam (colour) and Navcam pictures taken there (curiosity.ts)
// Both load on first use only.
import { render } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { data } from '../data/loader'
import { dataUrl } from '../env'
import { loadField } from '../hud/fields'
import type { FieldsIndex as HudFieldsIndex } from '../hud/types'
import { loadCuriosity, loadStopImages, RAW_IMAGE_PAGE, type Bounds, type DriveEnd, type RawImage } from './curiosity'
import type { MissionMap, Overlay } from './missionMap'
import type { LonLat } from './plan'
import { renderSlope, SLOPE_CLASSES } from './slope'

async function rgbaToUrl(rgba: Uint8ClampedArray, w: number, h: number): Promise<string> {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(rgba), w, h), 0, 0)
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'))
  if (!blob) throw new Error('could not encode the slope image')
  return URL.createObjectURL(blob)
}

type Status = 'off' | 'loading' | 'on' | 'error'

export function LayersControl({ mmap, bounds }: { mmap: MissionMap; bounds: Bounds }) {
  const [open, setOpen] = useState(true)
  const [st, setSt] = useState<Record<Overlay, Status>>({ slope: 'off', curiosity: 'off' })
  const [err, setErr] = useState<Partial<Record<Overlay, string>>>({})
  const [slopeFile, setSlopeFile] = useState<string | null>(null)
  const [nStops, setNStops] = useState<{ n: number; first: number; last: number } | null>(null)
  const loaded = useRef<Partial<Record<Overlay, boolean>>>({})
  const stops = useRef<DriveEnd[]>([])

  const set = (o: Overlay, s: Status) => setSt((x) => ({ ...x, [o]: s }))

  const load = async (o: Overlay) => {
    if (o === 'slope') {
      const fi = (await data().fieldsIndex()) as unknown as HudFieldsIndex
      const key = Object.keys(fi.fields).find((k) => k === 'slope' || k.endsWith('/slope'))
      if (!key) throw new Error('fields/index.json has no slope field')
      const g = await loadField(fi, key, dataUrl)
      const url = await rgbaToUrl(renderSlope(g.data.counts, g.data.known, g.data.scale), g.width, g.height)
      const corners: [LonLat, LonLat, LonLat, LonLat] = [
        [g.w, g.n],
        [g.e, g.n],
        [g.e, g.s],
        [g.w, g.s],
      ]
      await mmap.setSlopeImage(url, corners)
      setSlopeFile(fi.fields[key].file)
    } else {
      const c = await loadCuriosity(bounds)
      stops.current = c.stops
      setNStops(c.stops.length ? { n: c.stops.length, first: c.stops[0].sol, last: c.stops[c.stops.length - 1].sol } : { n: 0, first: 0, last: 0 })
      await mmap.setCuriosity(c.traverse, c.stops, (i) => openStop(i))
    }
  }

  const openStop = (i: number) => {
    const s = stops.current[i]
    if (!s) return
    const box = document.createElement('div')
    const pop = mmap.openPopup([s.lon, s.lat], box, '420px')
    render(<StopPhotos stop={s} next={stops.current[i + 1] ?? null} />, box)
    pop.on('close', () => render(null, box))
  }

  const toggle = async (o: Overlay, on: boolean) => {
    setErr((x) => ({ ...x, [o]: undefined }))
    if (!on) {
      set(o, 'off')
      await mmap.setOverlay(o, false)
      return
    }
    if (!loaded.current[o]) {
      set(o, 'loading')
      try {
        await load(o)
        loaded.current[o] = true
      } catch (e) {
        set(o, 'error')
        setErr((x) => ({ ...x, [o]: e instanceof Error ? e.message : String(e) }))
        return
      }
    }
    await mmap.setOverlay(o, true)
    set(o, 'on')
  }

  const row = (o: Overlay, label: string, title: string) => (
    <label class="mp-layer" title={title}>
      <input type="checkbox" checked={st[o] === 'on' || st[o] === 'loading'} disabled={st[o] === 'loading'} onChange={(e) => void toggle(o, (e.target as HTMLInputElement).checked)} />
      {label}
      {st[o] === 'loading' && <span class="muted"> loading…</span>}
    </label>
  )

  return (
    <div class="mp-layers">
      <button type="button" class="mp-layers-head" aria-expanded={open} onClick={() => setOpen((x) => !x)}>
        Layers {open ? '▾' : '▸'}
      </button>
      {open && (
        <div class="mp-layers-body">
          {row('slope', 'Slope', 'Ground slope in classes from config/site.yaml (pad-flat, walkable, beyond tested, no-go)')}
          {err.slope && <span class="mp-bad mp-layers-note">{err.slope}</span>}
          {st.slope === 'on' && (
            <>
              <ul class="mp-layers-legend">
                {SLOPE_CLASSES.map((c) => (
                  <li key={c.label} title={c.source}>
                    <span class="mp-swatch" style={{ background: `rgb(${c.rgb.join(',')})` }} />
                    {c.label}
                  </li>
                ))}
              </ul>
              <span class="mp-layers-note">
                WS1 cell slope, <code>{slopeFile}</code>; edges from <code>config/site.yaml</code>. Unknown ground is left clear.
              </span>
            </>
          )}
          {row('curiosity', 'Curiosity route + photos', "Curiosity's real drives inside this map, live from NASA. Click a yellow drive end for its pictures")}
          {err.curiosity && <span class="mp-bad mp-layers-note">Could not reach NASA: {err.curiosity}</span>}
          {st.curiosity === 'on' && nStops && (
            <span class="mp-layers-note">
              {nStops.n ? (
                <>
                  {nStops.n} drive ends, sols {nStops.first}–{nStops.last}. Click a yellow dot for its pictures. Live: NASA/JPL-Caltech MMGIS.
                </>
              ) : (
                'No Curiosity drive end inside this map.'
              )}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

const fmtM = (v: number | null) => (v === null ? '–' : v >= 1000 ? `${(v / 1000).toFixed(2)} km` : `${Math.round(v)} m`)

const SHOW = 12

function StopPhotos({ stop, next }: { stop: DriveEnd; next: DriveEnd | null }) {
  const [res, setRes] = useState<{ images: RawImage[]; sols: number[]; truncated: boolean } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [more, setMore] = useState<Record<string, boolean>>({})

  useEffect(() => {
    const ac = new AbortController()
    loadStopImages(stop, next, ac.signal).then(setRes, (e) => !ac.signal.aborted && setErr(e instanceof Error ? e.message : String(e)))
    return () => ac.abort()
  }, [stop.rmc])

  const solTxt = res ? (res.sols.length > 1 ? `sols ${res.sols[0]}–${res.sols[res.sols.length - 1]}` : `sol ${res.sols[0]}`) : `sol ${stop.sol}`
  return (
    <div class="mp-photos">
      <b>
        Curiosity drive end {stop.rmc} · sol {stop.sol}
      </b>
      <div class="muted">
        This drive {fmtM(stop.distM)} · odometer {fmtM(stop.totalM)} · {stop.lat.toFixed(5)}°, {stop.lon.toFixed(5)}°E
      </div>
      {err && <p class="mp-bad">Could not load the pictures: {err}</p>}
      {!res && !err && <p class="muted">Loading pictures from NASA…</p>}
      {res &&
        (['mastcam', 'navcam'] as const).map((cam) => {
          const list = res.images.filter((i) => i.camera === cam)
          const shown = more[cam] ? list : list.slice(0, SHOW)
          return (
            <section key={cam}>
              <h4>
                {cam === 'mastcam' ? 'Mastcam (colour)' : 'Navcam'} <span class="muted">({list.length})</span>
              </h4>
              {list.length === 0 ? (
                <p class="muted">None {cam === 'navcam' ? 'at this stop' : `on ${solTxt}`}.</p>
              ) : (
                <div class="mp-photo-grid">
                  {shown.map((i) => (
                    <a key={i.id} href={i.url} target="_blank" rel="noopener noreferrer" title={`${i.instrument} · sol ${i.sol} · ${i.takenUtc.replace('.000Z', 'Z')}`}>
                      <img src={i.url} loading="lazy" alt={`${i.instrument} sol ${i.sol}`} />
                    </a>
                  ))}
                </div>
              )}
              {list.length > SHOW && !more[cam] && (
                <button type="button" class="mp-clear" onClick={() => setMore((m) => ({ ...m, [cam]: true }))}>
                  Show all {list.length}
                </button>
              )}
            </section>
          )
        })}
      {res && (
        <p class="mp-maps-note">
          Navcam: frames with this stop's site/drive. Mastcam has no position in NASA's data, so it is matched by {solTxt} (frames from before the drive on sol {stop.sol} can be
          included).{res.truncated ? ' Long stay or many frames: only the first sols/pages were searched.' : ''} Raw images, NASA/JPL-Caltech/MSSS ·{' '}
          <a href={RAW_IMAGE_PAGE} target="_blank" rel="noopener noreferrer">
            raw-image archive
          </a>
        </p>
      )}
    </div>
  )
}

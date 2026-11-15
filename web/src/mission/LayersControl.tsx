// "Layers" panel (top right of the Mission Planer map): overlays on top of any map type.
//   - Slope: WS1's cell slope (fields/shared/slope.png) in classes from config/site.yaml (slope.ts)
//   - Curiosity: the rover's real traverse and drive ends inside the map area, live from NASA;
//     a click on a drive end opens the Mastcam (colour) and Navcam pictures taken there (curiosity.ts)
//   - Reachable area: WS2's walk-home band (30/60 min x estimate) or the limit edge coloured by cause,
//     on by default (30-min nominal band); moved here from the side panel (user 2026-11-15)
// Slope and Curiosity load on first use only.
import { render } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { data } from '../data/loader'
import { dataUrl } from '../env'
import { loadField } from '../hud/fields'
import type { FieldsIndex as HudFieldsIndex } from '../hud/types'
import { loadCuriosity, loadStopImages, RAW_IMAGE_PAGE, type Bounds, type DriveEnd, type RawImage } from './curiosity'
import type { MissionMap, Overlay } from './missionMap'
import { boundaryChoices, pickBoundary, type BoundaryOption, type BoundarySel, type LonLat } from './plan'
import { THEME } from '../theme'
import { renderSlope, SLOPE_CLASSES, SLOPE_OPACITY } from './slope'

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

export interface BoundaryProps {
  options: BoundaryOption[]
  /** initial walk-home budget (config walkback_budgets_min[0]) */
  budget: number
  /** file and scenario the drawn boundary comes from (caption) */
  fileOf: (o: BoundaryOption) => string
  scenarioId: string
}

export function LayersControl({ mmap, bounds, boundary }: { mmap: MissionMap; bounds: Bounds; boundary?: BoundaryProps }) {
  const [open, setOpen] = useState(false) // closed by default; the head shows "Layers ▸"
  const [st, setSt] = useState<Record<Overlay, Status>>({ slope: 'off', curiosity: 'off' })
  const [err, setErr] = useState<Partial<Record<Overlay, string>>>({})
  const [slopeFile, setSlopeFile] = useState<string | null>(null)
  const [opacity, setOpacity] = useState(SLOPE_OPACITY)
  const [nStops, setNStops] = useState<{ n: number; first: number; last: number } | null>(null)
  const loaded = useRef<Partial<Record<Overlay, boolean>>>({})
  const stops = useRef<DriveEnd[]>([])

  const set = (o: Overlay, s: Status) => setSt((x) => ({ ...x, [o]: s }))

  // Reachable area: kept here (not in Reachable) so it survives closing the panel; drawn on every change.
  const [sel, setSel] = useState<BoundarySel>(() => initialSel(boundary))
  useEffect(() => {
    if (boundary) void mmap.showBoundary(pickBoundary(boundary.options, sel))
  }, [sel, boundary])

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
          {boundary && <Reachable b={boundary} sel={sel} setSel={setSel} />}
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
              <label class="mp-layers-opacity">
                <span>Opacity</span>
                <input
                  type="range"
                  min={10}
                  max={100}
                  step={5}
                  value={Math.round(opacity * 100)}
                  aria-label="Slope layer opacity"
                  onInput={(e) => {
                    const v = Number((e.target as HTMLInputElement).value) / 100
                    setOpacity(v)
                    void mmap.setSlopeOpacity(v)
                  }}
                />
                <span>{Math.round(opacity * 100)}%</span>
              </label>
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

/** Default: on, the configured budget (else the first offered), nominal band (else the first estimate). */
function initialSel(b: BoundaryProps | undefined): BoundarySel {
  const c = b ? boundaryChoices(b.options) : { budgets: [], kinds: [], variants: [] }
  return {
    on: c.kinds.length > 0,
    budget: b && c.budgets.includes(b.budget) ? b.budget : (c.budgets[0] ?? 30),
    kind: c.kinds[0] ?? 'band',
    variant: c.variants.includes('nominal') ? 'nominal' : (c.variants[0] ?? 'nominal'),
  }
}

const KIND_LABEL: Record<BoundarySel['kind'], string> = { band: 'Band', edges: 'Edge by cause' }
const VARIANT_LABEL: Record<string, string> = { conservative: 'Cautious', nominal: 'Nominal', optimistic: 'Optimistic' }

function Chips<T extends string | number>({ label, items, value, text, onPick }: { label: string; items: T[]; value: T; text: (v: T) => string; onPick: (v: T) => void }) {
  if (items.length < 2) return null
  return (
    <div class="mp-chiprow" role="radiogroup" aria-label={label}>
      <span class="mp-chiprow-k">{label}</span>
      {items.map((v) => (
        <button key={String(v)} type="button" role="radio" aria-checked={v === value} class="mp-chip" onClick={() => onPick(v)}>
          {text(v)}
        </button>
      ))}
    </div>
  )
}

function Reachable({ b, sel, setSel }: { b: BoundaryProps; sel: BoundarySel; setSel: (f: (s: BoundarySel) => BoundarySel) => void }) {
  const c = boundaryChoices(b.options)
  if (!c.kinds.length) return null
  const drawn = pickBoundary(b.options, sel)
  return (
    <>
      <label class="mp-layer" title="The area from which the crew can still walk back to the pad within the chosen time (WS2)">
        <input type="checkbox" checked={sel.on} onChange={(e) => setSel((s) => ({ ...s, on: (e.target as HTMLInputElement).checked }))} />
        Reachable area
      </label>
      {sel.on && (
        <div class="mp-chips">
          <Chips label="Walk home" items={c.budgets} value={sel.budget} text={(v) => `${v} min`} onPick={(v) => setSel((s) => ({ ...s, budget: v }))} />
          <Chips label="Show" items={c.kinds} value={sel.kind} text={(v) => KIND_LABEL[v]} onPick={(v) => setSel((s) => ({ ...s, kind: v }))} />
          {sel.kind === 'band' && <Chips label="Estimate" items={c.variants} value={sel.variant} text={(v) => VARIANT_LABEL[v] ?? v} onPick={(v) => setSel((s) => ({ ...s, variant: v }))} />}
          {sel.kind === 'edges' && (
            <ul class="mp-layers-legend">
              {Object.keys(THEME.cause).map((k) => (
                <li key={k}>
                  <span class="mp-swatch" style={{ background: THEME.cause[k] }} />
                  {THEME.causeLabel[k] ?? k}
                </li>
              ))}
            </ul>
          )}
          <span class="mp-layers-note">{drawn ? <><code>{b.fileOf(drawn)}</code> ({b.scenarioId})</> : 'Not in the data for this choice.'}</span>
        </div>
      )}
    </>
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

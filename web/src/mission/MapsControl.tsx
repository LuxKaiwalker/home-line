// "Maps" switcher (bottom left of the Mission Planer map, PDF "Maps" button): Satellite (HiRISE
// basemap), Topography (hillshade + contours) and Material composition (regional rock class from
// the Unity scene's rocks, like the Unity EVA map's mineral layer). Rasters are rendered once per
// type on first use, on the routing grid.
import { useEffect, useRef, useState } from 'preact/hooks'
import type { FieldGrid } from '../hud/fields'
import type { MapType, MissionMap } from './missionMap'
import type { LonLat } from './plan'
import { buildUnitField, renderRelief, ROCKS_FILE, type Relief, type Unit } from './relief'

const TYPES: { id: MapType; label: string; swatch: string }[] = [
  { id: 'satellite', label: 'Satellite', swatch: 'linear-gradient(135deg, #8a5a3c, #c79a6b 55%, #5c3a28)' },
  { id: 'topo', label: 'Topography', swatch: 'repeating-radial-gradient(circle at 30% 70%, #4e3c2c 0 5px, #e2d6c4 5px 6px)' },
  { id: 'material', label: 'Material', swatch: 'linear-gradient(180deg, #b394e6 0 33%, #5e93d9 33% 66%, #8fa6bf 66%)' },
]

export interface ReliefSource {
  grid: FieldGrid
  elev: Float32Array
  resM: number
  hasBasemap: boolean
}

async function toBlobUrl(r: Relief): Promise<string> {
  const canvas = document.createElement('canvas')
  canvas.width = r.width
  canvas.height = r.height
  canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(r.rgba), r.width, r.height), 0, 0)
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'))
  if (!blob) throw new Error('could not encode the relief image')
  return URL.createObjectURL(blob)
}

export function MapsControl({ mmap, src }: { mmap: MissionMap; src: ReliefSource }) {
  const [open, setOpen] = useState(false)
  const [type, setType] = useState<MapType>(src.hasBasemap ? 'satellite' : 'topo')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [relief, setRelief] = useState<Partial<Record<MapType, Relief>>>({})
  const [units, setUnits] = useState<Unit[]>([])
  const seq = useRef(0)

  useEffect(() => {
    const s = ++seq.current
    void (async () => {
      setError(null)
      if (type === 'satellite') return mmap.setMapType('satellite')
      let r = relief[type]
      if (!r) {
        setBusy(true)
        await new Promise((res) => setTimeout(res, 20)) // let "Rendering…" paint
        try {
          const { grid, elev, resM } = src
          const u =
            type === 'material'
              ? buildUnitField(ROCKS_FILE.rocks, ROCKS_FILE.classes, grid, grid.width * resM, grid.height * resM)
              : null
          r = renderRelief(elev, grid.width, grid.height, resM, type, u)
          if (u) setUnits(u.units)
          setRelief((x) => ({ ...x, [type]: r }))
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e))
          setBusy(false)
          return
        }
      }
      if (s !== seq.current) return
      const g = src.grid
      const corners: [LonLat, LonLat, LonLat, LonLat] = [
        [g.w, g.n],
        [g.e, g.n],
        [g.e, g.s],
        [g.w, g.s],
      ]
      await mmap.setRelief(await toBlobUrl(r), corners)
      await mmap.setMapType(type)
      setBusy(false)
    })()
  }, [type])

  const cur = TYPES.find((t) => t.id === type)!
  const r = relief[type]
  return (
    <div class="mp-maps">
      {busy && <div class="mp-maps-legend">Rendering {cur.label.toLowerCase()}…</div>}
      {error && <div class="mp-maps-legend mp-bad">{error}</div>}
      {!busy && r && type === 'topo' && (
        <div class="mp-maps-legend">
          Contours every {r.contourM} m (bold every {r.contourM * 5} m) · {Math.round(r.minE)} to {Math.round(r.maxE)} m (MOLA areoid), 8 m terrain heights
        </div>
      )}
      {!busy && r && type === 'material' && <MaterialLegend r={r} units={units} />}
      {open && (
        <div class="mp-maps-menu" role="menu">
          {TYPES.map((t) => (
            <button
              key={t.id}
              type="button"
              role="menuitemradio"
              aria-checked={t.id === type}
              class={`mp-maps-tile${t.id === type ? ' on' : ''}`}
              disabled={t.id === 'satellite' && !src.hasBasemap}
              title={t.id === 'satellite' && !src.hasBasemap ? 'No basemap tiles in this data tree' : undefined}
              onClick={() => {
                setType(t.id)
                setOpen(false)
              }}
            >
              <span class="mp-maps-swatch" style={{ background: t.swatch }} />
              {t.label}
            </button>
          ))}
        </div>
      )}
      <button type="button" class="mp-maps-btn" aria-expanded={open} onClick={() => setOpen((o) => !o)} title="Change the map type">
        <span class="mp-maps-swatch" style={{ background: cur.swatch }} />
        <span>
          <b>Maps</b>
          <br />
          {cur.label}
        </span>
      </button>
    </div>
  )
}

function MaterialLegend({ r, units }: { r: Relief; units: Unit[] }) {
  const shown = units.filter((u) => (r.unitCells.get(u.id) ?? 0) > 0)
  return (
    <div class="mp-maps-legend">
      <b>Mineral units</b>
      <ul>
        {shown.length ? (
          shown.map((u) => (
            <li key={u.id} title={u.name}>
              <span class="mp-swatch" style={{ background: `rgb(${u.rgb.join(',')})` }} />
              {u.label}
            </li>
          ))
        ) : (
          <li>No rocks on this terrain.</li>
        )}
      </ul>
      <span class="mp-maps-note" title={ROCKS_FILE.source}>
        Same layer as the Unity EVA map: the dominant class of the {ROCKS_FILE.rocks.length.toLocaleString('en')} field rocks
        nearby (Gaussian, 70 m). Not a mineral survey.
      </span>
    </div>
  )
}

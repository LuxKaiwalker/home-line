// Analysis CRS (config/site.yaml crs.analysis_proj; recorded in fp3d/index.json "crs"):
// PROJ equirectangular on the Mars sphere. Parsed from the PROJ string so no constant is copied.
//   x = x_0 + R (lon - lon_0) cos(lat_ts),  y = y_0 + R (lat - lat_0)   (radians)

export interface Eqc {
  R: number
  latTsDeg: number
  lon0Deg: number
  lat0Deg: number
  x0: number
  y0: number
}

const DEG = Math.PI / 180

export function parseEqc(proj: string): Eqc {
  const kv = new Map<string, string>()
  for (const tok of proj.trim().split(/\s+/)) {
    const m = /^\+([A-Za-z_0-9]+)(?:=(.*))?$/.exec(tok)
    if (m) kv.set(m[1], m[2] ?? '')
  }
  if (kv.get('proj') !== 'eqc') throw new Error(`not an eqc projection: ${proj}`)
  const units = kv.get('units')
  if (units !== undefined && units !== 'm') throw new Error(`eqc units must be m: ${proj}`)
  const R = Number(kv.get('R'))
  if (!Number.isFinite(R) || R <= 0) throw new Error(`eqc needs +R: ${proj}`)
  const n = (k: string) => {
    const v = kv.get(k)
    if (v === undefined) return 0 // PROJ default for these parameters
    const x = Number(v)
    if (!Number.isFinite(x)) throw new Error(`bad +${k} in ${proj}`)
    return x
  }
  return { R, latTsDeg: n('lat_ts'), lon0Deg: n('lon_0'), lat0Deg: n('lat_0'), x0: n('x_0'), y0: n('y_0') }
}

export function lonLatToXY(p: Eqc, lon: number, lat: number): [number, number] {
  return [
    p.x0 + p.R * (lon - p.lon0Deg) * DEG * Math.cos(p.latTsDeg * DEG),
    p.y0 + p.R * (lat - p.lat0Deg) * DEG,
  ]
}

export function xyToLonLat(p: Eqc, x: number, y: number): [number, number] {
  return [
    p.lon0Deg + (x - p.x0) / (p.R * Math.cos(p.latTsDeg * DEG)) / DEG,
    p.lat0Deg + (y - p.y0) / p.R / DEG,
  ]
}

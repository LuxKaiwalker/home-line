// Where every number on the HUD panel comes from (AGENTS rule 6, SPEC F16). Field lookups are
// per pixel, so they are backed by the file-level manifest key `fields.<key>.sha256` that
// pipeline/export/fields_png.py records for each PNG; timeline / station / rad values are read
// from those files (WS5's provenance resolves them by file + value). The panel puts the keys and
// files on each row (data-manifest-key, data-source-files, tooltip).
import type { Readout } from './readout'

export type PanelRow = 'tHome' | 'margin' | 'o2' | 'binding' | 'turn' | 'rover' | 'next' | 'slope' | 'partner' | 'sun' | 'dose' | 'trip'

export interface RowSource {
  keys: string[]
  files: string[]
}

export interface KeyContext {
  scenario: string
  consScenario?: string | null
  padFromFile?: boolean
  partnerFile?: string | null
  /** sun row (sun.ts sunSources: the observers actually shown); default t_dark_min + sun_series */
  sunSources?: RowSource | null
}

export function readoutSources(r: Readout, k: KeyContext): Record<PanelRow, RowSource> {
  const { scenario, consScenario } = k
  const worst = r.worstRadiusM && r.worstRadiusM > 0 ? `_worst_${r.worstRadiusM}` : ''
  const field = (key: string): RowSource => ({ keys: [`fields.${key}.sha256`], files: [`fields/${key}.png`] })
  const join = (...xs: RowSource[]): RowSource => ({ keys: xs.flatMap((x) => x.keys), files: xs.flatMap((x) => x.files) })
  const file = (...files: string[]): RowSource => ({ keys: [], files })
  const timeline = file(`timeline_${scenario}.json`)
  const tHome = field(`${scenario}/t_home${worst}`)
  return {
    tHome: consScenario ? join(tHome, field(`${consScenario}/t_home`)) : tHome,
    margin: join(timeline, tHome),
    o2: join(timeline, field(`${scenario}/o2_home${worst}`)),
    binding: timeline,
    turn: join(timeline, tHome),
    rover: join(field(`${scenario}/home_bearing`), file(k.padFromFile ? 'pad.json' : `route_${scenario}.geojson`)),
    next: join(timeline, file('stations.json')),
    slope: { keys: ['fields.slope.sha256'], files: ['fields/shared/slope.png', 'config/crew.yaml'] },
    partner: file(k.partnerFile ?? `scenarios/${scenario}/partner.geojson`),
    sun: k.sunSources ?? { keys: ['clock.eva.t_dark_min', 'clock.eva.sun_series'], files: ['conditions/clock.json'] },
    dose: file('conditions/rad.json'),
    trip: file('conditions/rad.json'),
  }
}

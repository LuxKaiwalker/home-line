// Pad marker (F8): position from pad.json (WS2 siting rule); without pad.json, the default from
// config/site.yaml pad_default, labelled as such.
import type { PadFile } from '../data/types'

export interface PadMarkerInfo {
  lon: number
  lat: number
  /** Data file the position was read from (null = config/site.yaml). */
  file: string | null
  sourceLabel: string
  title: string
}

export function padMarker(p: PadFile | null, cfg: { lon: number; lat: number }): PadMarkerInfo {
  if (p) {
    const passed = p.pad.checks.rule_passed
    const rule = passed === true ? 'siting rule passed' : passed === false ? 'siting rule NOT passed' : 'siting rule not evaluated'
    return {
      lon: p.pad.lon,
      lat: p.pad.lat,
      file: 'pad.json',
      sourceLabel: `pad.json, ${rule}`,
      title: `Rover pad (pad.json, site rule ${p.site_rule_version}): ${rule}`,
    }
  }
  return {
    lon: cfg.lon,
    lat: cfg.lat,
    file: null,
    sourceLabel: 'config/site.yaml pad_default; pad.json not available yet',
    title: 'Rover pad: default position from config/site.yaml pad_default (pad.json not available yet)',
  }
}

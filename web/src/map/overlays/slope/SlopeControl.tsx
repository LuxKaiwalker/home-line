// PORT L1a: the slope row of the Plan layer popover (registerMapControl slot 'layers-popover'): toggle,
// trust chip, one-line "what", legend (class swatches + names + config edges), opacity slider while on,
// and the source note (slope raster file + config/site.yaml). Port of the slope part of
// mission/LayersControl.tsx in the U7 layer-panel look (map/overlays/LayerPanel.tsx).
import { getManifest } from '../../../prov/store'
import { formatValue } from '../../../prov/provenance'
import { useSignalValue } from '../../../state/signal'
import { Slider, Toggle, TrustChip } from '../../../ui/components'
import { copyFrom } from '../../../ui/copy'
import { SLOPE_COLORS, SLOPE_OPACITY, slopeClasses, slopeColorVar, type SlopeClass, type SlopeLimits } from './classes'
import copyJson from './copy.L1a.json'
import { setSlopeOn, setSlopeOpacity, slopeError, slopeFile, slopeOn, slopeOpacity, slopeStatus } from './state'
import '../overlays.css'
import './slope.css'

const tl = copyFrom(copyJson)

/** Manifest entry backing the slope raster (pipeline/export/fields_png.py). */
export const SLOPE_PROV_KEY = 'fields.slope.sha256'
/** The slope raster as fields/index.json lists it today (shown until the layer has loaded). */
export const SLOPE_FILE_DEFAULT = 'fields/shared/slope.png'
/** Where the class edges come from. */
export const SLOPE_SITE_FILE = 'config/site.yaml'

const pct = (v: number): number => Math.round(v * 100)
const deg = (v: number): string => formatValue(v, 'deg')

/** "under 5°", "5° to 17°", "25° and steeper" (numbers from config). */
export function rangeText(c: SlopeClass): string {
  if (c.minDeg <= 0) return tl('range.below', { max: deg(c.maxDeg) })
  if (!Number.isFinite(c.maxDeg)) return tl('range.above', { min: deg(c.minDeg) })
  return tl('range.between', { min: deg(c.minDeg), max: deg(c.maxDeg) })
}

export function SlopeLegend({ limits }: { limits?: SlopeLimits }) {
  const classes = slopeClasses(limits)
  return (
    <ul class="hl-ovl__legend hl-slope__legend" role="list" aria-label={tl('title')}>
      {classes.map((c) => (
        <li class="hl-legend-row hl-ovl__legend-row" data-slope-class={c.id} title={tl('edgeSource', { source: c.source })}>
          <span class="hl-swatch hl-swatch--fill" style={{ '--sw': slopeColorVar(c.id) }} data-recipe={JSON.stringify(SLOPE_COLORS[c.id])} aria-hidden="true" />
          <span class="hl-legend-row__label">
            {tl(`classes.${c.id}`)} <span class="hl-slope__range">{rangeText(c)}</span>
          </span>
        </li>
      ))}
      <li class="hl-legend-row hl-ovl__legend-row" data-slope-class="unknown">
        <span class="hl-swatch hl-swatch--none" aria-hidden="true" />
        <span class="hl-legend-row__label">
          {tl('classes.unknown')} <span class="hl-slope__range">{tl('range.clear')}</span>
        </span>
      </li>
    </ul>
  )
}

function manifestValue(k: string): unknown {
  const e = getManifest()?.[k] as { value?: unknown } | undefined
  return e && typeof e === 'object' && 'value' in e ? e.value : ''
}

export function SlopeControl({ limits }: { limits?: SlopeLimits } = {}) {
  const on = useSignalValue(slopeOn)
  const op = useSignalValue(slopeOpacity)
  const status = useSignalValue(slopeStatus)
  const err = useSignalValue(slopeError)
  const file = useSignalValue(slopeFile) ?? SLOPE_FILE_DEFAULT
  const name = tl('title')
  return (
    <div class="hl-ovl__layer hl-slope" data-overlay="slope" data-chip="modelled" data-status={status}>
      <div class="hl-ovl__head">
        <Toggle label={name} checked={on} onChange={setSlopeOn} />
        <TrustChip kind="modelled" prov={{ key: SLOPE_PROV_KEY, file, value: manifestValue(SLOPE_PROV_KEY) }} align="end" />
      </div>
      <p class="hl-ovl__what">{tl('what')}</p>
      {on && status === 'loading' && (
        <p class="hl-ovl__what hl-slope__status" role="status">
          {tl('loading')}
        </p>
      )}
      {err && (
        <p class="hl-ovl__what hl-slope__error" role="alert">
          {tl('error', { error: err })}
        </p>
      )}
      <SlopeLegend limits={limits} />
      {on && (
        <Slider label={tl('opacity')} min={pct(SLOPE_OPACITY.min)} max={pct(SLOPE_OPACITY.max)} step={pct(SLOPE_OPACITY.step)} value={pct(op)} units="%" onChange={(v) => setSlopeOpacity(v / 100)} />
      )}
      <p class="hl-ovl__what hl-slope__note">{tl('note', { file, site: SLOPE_SITE_FILE })}</p>
    </div>
  )
}

// L1c: the "Maps" switcher on the Plan map edge (registerMapControl slot 'map-edge'), ported from the
// Mission Planer's MapsControl: Satellite (default) · Topography · Material, plus the legend of the
// chosen relief map with its source and trust note (topography: modelled from terrain heights;
// material: simulated, the Unity scene's rock population, not a mineral survey).
import { useSignalValue } from '../../state/signal'
import { Segmented, TrustChip, type Option } from '../../ui/components'
import { t } from '../../ui/copy'
import { ROCKS_FILE, UNIT_SIGMA_M, type Relief, type Unit } from './relief'
import { activeBasemap, BASEMAP_IDS, reliefStatus, setBasemap, type BasemapId } from './store'
import './basemaps.css'

const label = (id: BasemapId) => t(`route.basemaps.${id}`)
/** Unit colour (Unity MapPalette data colour, not a design token) as a CSS colour string. */
export const unitColor = (rgb: readonly number[]) => '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('')

export function BasemapControl() {
  const cur = useSignalValue(activeBasemap)
  const st = useSignalValue(reliefStatus)
  const options: Option<BasemapId>[] = BASEMAP_IDS.map((id) => ({ value: id, label: label(id) }))
  const s = cur === 'satellite' ? null : st[cur]
  return (
    <div class="hl-basemaps" data-basemap={cur}>
      <Segmented label={t('route.basemaps.label')} options={options} value={cur} onChange={setBasemap} />
      {/* one live region that stays mounted (PORT I4 a11y): an inserted region is often not announced */}
      <div role="status" data-live="basemap">
        {s?.kind === 'rendering' && <p class="hl-basemaps__muted">{t('route.basemaps.rendering', { type: label(cur).toLowerCase() })}</p>}
        {s?.kind === 'error' && <p class="hl-basemaps__error">{t('route.basemaps.error', { type: label(cur).toLowerCase(), reason: s.message })}</p>}
      </div>
      {s?.kind === 'ready' && cur === 'topo' && <TopoLegend r={s.relief} resM={s.elevationResM} />}
      {s?.kind === 'ready' && cur === 'material' && <MaterialLegend r={s.relief} units={s.units} />}
    </div>
  )
}

function TopoLegend({ r, resM }: { r: Relief; resM: number }) {
  return (
    <div class="hl-basemaps__legend" data-legend="topo">
      <div class="hl-basemaps__head">
        <span>{t('route.basemaps.topoLegend', { step: r.contourM, bold: r.contourM * 5, low: Math.round(r.minE), high: Math.round(r.maxE), res_m: resM })}</span>
        <TrustChip kind="modelled" />
      </div>
      <p class="hl-basemaps__muted">{t('route.basemaps.topoNote')}</p>
    </div>
  )
}

function MaterialLegend({ r, units }: { r: Relief; units: Unit[] }) {
  const shown = units.filter((u) => (r.unitCells.get(u.id) ?? 0) > 0)
  return (
    <div class="hl-basemaps__legend" data-legend="material">
      <div class="hl-basemaps__head">
        <b>{t('route.basemaps.materialTitle')}</b>
        <TrustChip kind="simulated" />
      </div>
      <ul class="hl-basemaps__units">
        {shown.length ? (
          shown.map((u) => (
            <li key={u.id} title={u.name} class="hl-legend-row">
              <span class="hl-swatch hl-swatch--fill" style={{ '--sw': unitColor(u.rgb) }} aria-hidden="true" />
              <span class="hl-legend-row__label">{u.label}</span>
            </li>
          ))
        ) : (
          <li>{t('route.basemaps.noUnit')}</li>
        )}
      </ul>
      <p class="hl-basemaps__muted" title={ROCKS_FILE.source}>
        {t('route.basemaps.materialNote', { count: ROCKS_FILE.rocks.length.toLocaleString('en'), sigma_m: UNIT_SIGMA_M })}
      </p>
    </div>
  )
}

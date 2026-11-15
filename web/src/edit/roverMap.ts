// Drag the rover on the planning map (WS18 task 2, U15 flagship; static mode). Loaded lazily by
// ConsoleMap in the shell frame only (the legacy frame stays as it was).
//
//   pointer   the rover marker is draggable; while dragging, a readout under it shows exact field
//             lookups at the dragged cell (validity, elevation "—", slope) and ghost rows
//             ("computing…"); on release it snaps to the nearest valid precomputed pad
//   map       on release the console shows that pad's precomputed homeline (mission.plan written
//             without an undo step) and the previous homeline fades out over it (reduced motion: no
//             fade); Escape / Discard puts the committed plan back, Enter / Keep commits (H1 undo step)
//   sidebar   the delta strip sits above the selection card while a released draft is open
//   keyboard  the rover marker is focusable; with the rover selected, arrow keys cycle the pads
//
// Static mode only: no fetch happens during a drag (fields, pads index and slope are loaded at
// install, through the shared loader cache), and no server-only option is offered.
import { Marker, type Map as MlMap } from 'maplibre-gl'
import { h, render } from 'preact'
import { data } from '../data/loader'
import { parsePadsIndex, PADS_INDEX, padFiles, type PadsIndexView } from '../data/pads'
import type { BandsFC, ScenariosIndex } from '../data/types'
import { dataUrl } from '../env'
import { FieldGrid, loadField } from '../hud/fields'
import { fieldAt, loadFieldData, type FieldData } from '../map/field'
import { mission } from '../state/mission'
import { select, selection } from '../state/selection'
import { effect } from '../state/signal'
import { ui } from '../state/ui'
import { t } from '../ui/copy'
import { isTypingTarget } from '../ui/shell/keys'
import { openSidebar, setSidebarContent, sidebarContent, type Render } from '../ui/shell/store'
import { applyToMission, installPlanEdit, missionApply } from './bind'
import { crossfadeFrom, crossfadeMs } from './crossfade'
import type { DragFields } from './drag'
import { isCustomPad, loadEditCatalog, planAvailability, type EditCatalog, type EditPlan } from './options'
import { createRoverDrag, type RoverDrag } from './rover'
import { createPlanEditStore, type PlanEditStore, type PlanStep } from './store'
import { DeltaStrip, DragReadout } from './ui'
import './edit.css'

export interface RoverHandle {
  attach(marker: Marker): void
  destroy(): void
  /** for tests and RR: the controller once loaded */
  readonly rover: RoverDrag | null
}

/** The plan the console shows now, if it is a precomputed one (else the store's default). */
function initialPlan(c: EditCatalog): EditPlan | undefined {
  const p: EditPlan = { scenario: mission.plan.scenario.peek() ?? c.defaultScenario, budgetMin: mission.plan.budgetMin.peek(), pad: mission.plan.pad.peek() ?? c.officialPadId, dwell: {} }
  return planAvailability(p, c, false).ok ? p : undefined
}

async function loadDragFields(suitKg: number): Promise<{ fields: DragFields; fd: FieldData }> {
  const L = data()
  const [idx, fd, cs] = await Promise.all([L.fieldsIndex(), loadFieldData(suitKg), L.optional(() => L.cellstate())])
  const slope: FieldGrid | null = idx.fields.slope ? await loadField(idx, 'slope', (p) => dataUrl(p)).catch(() => null) : null
  const cellM = Math.min(idx.res_m, cs?.res_m ?? idx.res_m)
  return {
    fd,
    fields: {
      // fieldAt is the published field the map shows; with a parking option shown it is cleared, so
      // the same decoded FieldData (identical lookups) answers instead
      sample: (lon, lat) => fieldAt(lon, lat) ?? fd.at(lon, lat),
      slope: (lon, lat) => (slope ? slope.valueAt(lon, lat) : null),
      grid: slope ? { bounds: [slope.w, slope.s, slope.e, slope.n], mPerDegLon: slope.mPerDegLon, mPerDegLat: slope.mPerDegLat, cellM } : null,
    },
  }
}

const sameStep = (a: PlanStep | null, b: PlanStep): boolean => !!a && a.key === b.key && JSON.stringify(a.plan) === JSON.stringify(b.plan)

export function installRoverDrag(map: MlMap): RoverHandle {
  let alive = true
  let marker: Marker | null = null
  let rover: RoverDrag | null = null
  let store: PlanEditStore | null = null
  let pads: PadsIndexView | null = null
  const offs: (() => void)[] = []

  // readout under the rover while dragging
  const readoutEl = document.createElement('div')
  readoutEl.className = 'hl-edit-drag-host'
  const readout = new Marker({ element: readoutEl, anchor: 'top', offset: [0, 18] })
  let readoutOn = false

  // what the map shows: the committed plan, or a released draft's precomputed plan
  let shown: PlanStep | null = null
  let stopFade: (() => void) | null = null

  const L = data()
  const scenarioIndex = () => L.scenarios() as Promise<ScenariosIndex>
  async function bandsOf(plan: EditPlan): Promise<BandsFC | null> {
    try {
      const idx = await scenarioIndex()
      if (isCustomPad(plan.pad)) return null
      if (plan.pad === store!.catalog.officialPadId) {
        const s = idx.scenarios.find((x) => x.id === plan.scenario)
        return s ? await L.bands(s) : null
      }
      const nominal = idx.scenarios.find((x) => x.id === idx.default)
      return nominal ? await L.json<BandsFC>(padFiles(plan.pad, nominal).bands) : null
    } catch {
      return null
    }
  }

  /** Show `step` on the map (no undo step); the homeline shown so far fades out over it. */
  function show(step: PlanStep): void {
    if (!store || sameStep(shown, step)) return
    const from = shown
    shown = step
    const ms = crossfadeMs(ui.reducedMotion.peek())
    stopFade?.()
    stopFade = null
    if (from && ms > 0) {
      const variant = store.catalog.scenarios.find((s) => s.id === from.plan.scenario)?.variant ?? 'nominal'
      void bandsOf(from.plan).then((b) => {
        if (alive && b) stopFade = crossfadeFrom(map, b, from.plan.budgetMin, variant, ms)
      })
    }
    applyToMission(store, step, store.resultOf(step))
    placeRover()
  }

  function placeRover(): void {
    if (!marker || !rover || !store) return
    const s = rover.state.peek()
    if (s?.phase === 'dragging') return
    const at = s?.phase === 'released' ? s.at : rover.committedAt()
    marker.setLngLat([at.lon, at.lat])
  }

  // ---- sidebar: the delta strip above whatever the sidebar shows (A5 selection card) -----------
  let base: Render | undefined
  let mine: Render | null = null
  function mountStrip(on: boolean): void {
    if (on && !mine && store && rover && pads) {
      base = sidebarContent.peek()
      const st = store
      const rd = rover
      const pd = pads
      const b = base
      mine = () => [h(DeltaStrip, { store: st, rover: rd, pads: pd, key: 'hl-edit-delta' }), b ? h('div', { key: 'base' }, b()) : null]
      setSidebarContent(mine)
      openSidebar()
    } else if (!on && mine) {
      if (sidebarContent.peek() === mine) setSidebarContent(base)
      mine = null
    }
  }

  // ---- keyboard alternative ----------------------------------------------------------------
  const onKey = (e: KeyboardEvent) => {
    if (!rover || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || isTypingTarget(e.target)) return
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!dir || selection.selected.peek()?.kind !== 'pad') return
    rover.cycle(dir)
    e.preventDefault()
    e.stopPropagation() // the map would pan
  }
  window.addEventListener('keydown', onKey, { capture: true })
  offs.push(() => window.removeEventListener('keydown', onKey, { capture: true }))

  // ---- pointer -----------------------------------------------------------------------------
  let raf = 0
  function wire(m: Marker): void {
    const el = m.getElement()
    el.tabIndex = 0
    el.setAttribute('role', 'button')
    el.setAttribute('aria-label', t('buttons.moveRover'))
    el.title = t('tooltips.dragRover')
    el.classList.add('hl-edit-rover')
    m.setDraggable(true)
    m.on('dragstart', () => {
      if (!rover) return
      el.classList.add('is-dragging')
      const p = m.getLngLat()
      rover.begin({ lon: p.lng, lat: p.lat })
    })
    m.on('drag', () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        const p = m.getLngLat()
        rover?.move({ lon: p.lng, lat: p.lat })
      })
    })
    m.on('dragend', () => {
      cancelAnimationFrame(raf)
      raf = 0
      el.classList.remove('is-dragging')
      if (!rover) return
      const p = m.getLngLat()
      rover.move({ lon: p.lng, lat: p.lat })
      rover.end()
      placeRover()
    })
    const pick = () => {
      const id = rover?.committedPadId()
      if (id) select({ kind: 'pad', id }, 'map')
    }
    el.addEventListener('click', (e) => {
      e.stopPropagation()
      pick()
    })
    el.addEventListener('keydown', (e) => {
      if (e.key === ' ' || (e.key === 'Enter' && !store?.draft.peek())) {
        e.preventDefault()
        pick()
      }
    })
  }

  // ---- load --------------------------------------------------------------------------------
  void (async () => {
    try {
      const catalog = await loadEditCatalog((p) => L.json(p))
      const padScenarioSuit = catalog.scenarios.find((s) => s.id === catalog.padScenario)?.suit_kg ?? 104
      const [{ fields }, rawPads] = await Promise.all([loadDragFields(padScenarioSuit), L.json<unknown>(PADS_INDEX)])
      if (!alive) return
      pads = parsePadsIndex(rawPads)
      store = createPlanEditStore({ catalog, initial: initialPlan(catalog), onApply: missionApply })
      offs.push(installPlanEdit(store))
      rover = createRoverDrag(store, fields)
      const st = store
      const rd = rover
      shown = st.committed.peek()
      // map follows the store: released draft = its precomputed plan; otherwise the committed plan
      offs.push(
        effect(() => {
          const d = st.draft.value
          const c = st.committed.value
          void rd.state.value
          if (d && d.phase === 'released' && d.availability.ok) show(d.step)
          else if (!d) {
            show(c)
            placeRover()
          }
          mountStrip(!!d && d.phase === 'released')
        }),
      )
      // readout follows the dragged spot
      offs.push(
        effect(() => {
          const s = rd.state.value
          if (s?.phase === 'dragging' && s.values) {
            const target = s.target ? (pads!.options.find((o) => o.id === s.target!.id) ?? null) : null
            render(h(DragReadout, { values: s.values, target }), readoutEl)
            readout.setLngLat([s.at.lon, s.at.lat])
            if (!readoutOn) readout.addTo(map)
            readoutOn = true
          } else if (readoutOn) {
            readout.remove()
            render(null, readoutEl)
            readoutOn = false
          }
        }),
      )
      if (marker) wire(marker)
      placeRover()
    } catch (e) {
      console.warn('drag the rover unavailable:', e)
    }
  })()

  return {
    get rover() {
      return rover
    },
    attach(m: Marker) {
      marker = m
      if (rover) {
        wire(m)
        placeRover()
      }
    },
    destroy() {
      alive = false
      cancelAnimationFrame(raf)
      stopFade?.()
      mountStrip(false)
      readout.remove()
      render(null, readoutEl)
      for (const f of offs.reverse()) f()
      marker?.setDraggable(false)
    },
  }
}

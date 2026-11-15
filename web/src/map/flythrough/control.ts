// WS16 task 10 (M10): the "Flythrough" button of the planning map (DESIGN U6) with its speed control.
// Small and GL-free; the flight itself (fly.ts) loads with import() on the first press.
import type { IControl, Map as MlMap } from 'maplibre-gl'
import { effect, mission, missionClock } from '../../state'
import { activity, controlState, end as endPlayer, start as startPlayer } from '../../state/activity'
import { installActivityClock } from '../../state/activityClock'
import { t } from '../../ui/copy'
import { iconSvg } from '../../ui/icons/icons'
import type { FlyLayers } from './fly'
import { planning } from '../../state/planning'
import { getRouteResults, subscribeRouteResults } from '../../state/routeResults'
import { flyMine, userFlight } from './userRoute'
import './flythrough.css'

/** PORT FX: the "Your route" fly toggle is off until the HUD says "Official plan values" over it. */
const FLY_MINE_TOGGLE = false

export class FlythroughControl implements IControl {
  private el: HTMLDivElement | null = null
  private stops: (() => void)[] = []
  private flight: { stop(): void } | null = null
  private flying = false
  private readonly layers: FlyLayers | undefined

  constructor(layers?: FlyLayers) {
    this.layers = layers
  }

  onAdd(map: MlMap): HTMLElement {
    const box = document.createElement('div')
    box.className = 'maplibregl-ctrl maplibregl-ctrl-group hl-fly'
    const go = document.createElement('button')
    go.type = 'button'
    go.className = 'hl-fly-btn'
    // L2c (D111): icon + label; the Plan map-edge tools show the icon only (label = name + tooltip)
    go.innerHTML = `${iconSvg('camera', { className: 'hl-ctrl-icon' })}<span class="hl-ctrl-text"></span>`
    go.querySelector('.hl-ctrl-text')!.textContent = t('buttons.flythrough')
    go.title = t('buttons.flythrough')
    go.setAttribute('aria-pressed', 'false')
    const speed = document.createElement('button')
    speed.type = 'button'
    speed.className = 'hl-fly-btn hl-fly-speed'
    speed.hidden = true
    // PORT I2: "Your route" toggle (shown only while a user route is computed): fly it, not the official one
    const mine = document.createElement('button')
    mine.type = 'button'
    mine.className = 'hl-fly-btn hl-fly-mine'
    mine.textContent = t('route.fly.mine')
    mine.title = t('route.fly.mineTip')
    mine.hidden = true
    mine.addEventListener('click', () => {
      flyMine.value = !flyMine.peek()
    })
    const mineFlight = () => userFlight(getRouteResults(), planning.doc.peek().route, planning.doc.peek().padId)
    const syncMine = () => {
      // PORT FX (team lead 22:20): the toggle stays hidden until the HUD can label its numbers as the
      // official plan's over the user's route; the code is kept, only never unhidden
      const has = FLY_MINE_TOGGLE && mineFlight() !== null
      mine.hidden = !has
      mine.setAttribute('aria-pressed', String(has && flyMine.peek()))
    }
    syncMine()
    this.stops.push(subscribeRouteResults(syncMine), planning.doc.subscribe(syncMine), flyMine.subscribe(syncMine))
    // L7c: the flythrough is a player of the activity store (state/activity.ts): starting it stops the
    // replay / intro; the store stops it when another player starts, on an edit or a mode switch
    installActivityClock()
    const halt = (): void => {
      if (!this.flying) return
      this.flying = false // a flight still loading sees this and never starts
      this.flight?.stop()
      setFlying(false)
    }
    const setFlying = (on: boolean): void => {
      this.flying = on
      go.setAttribute('aria-pressed', String(on))
      speed.hidden = !on
      if (!on) endPlayer('flythrough', halt)
    }
    go.addEventListener('click', () => {
      if (this.flying) {
        halt()
        return
      }
      if (!startPlayer('flythrough', halt).ok) return
      setFlying(true)
      void import('./fly').then(async (m) => {
        if (!this.flying) return
        const flight = await m.startFlythrough(
          map,
          () => {
            this.flight = null
            setFlying(false)
          },
          this.layers,
          flyMine.peek() ? mineFlight() : null,
        )
        // stopped (store or button) while the path loaded: land at once; its stop pauses the mission
        // clock, so a replay started meanwhile plays on (the clock observer registers it again)
        if (flight && !this.flying) {
          const replaying = activity.current.peek() === 'replay'
          flight.stop()
          if (replaying) missionClock.play()
          return
        }
        this.flight = flight
        if (!this.flight) setFlying(false)
      })
    })
    // speed: cycle the mission clock's playback speeds (config/hud.yaml playback_speeds)
    speed.addEventListener('click', () => {
      const sp = missionClock.speeds
      missionClock.setSpeed(sp[(sp.indexOf(missionClock.speed) + 1) % sp.length])
    })
    this.stops.push(
      effect(() => {
        const st = controlState('flythrough')
        go.disabled = !st.enabled
        go.title = st.title
        if (st.reason) go.dataset.activityReason = st.reason
        else delete go.dataset.activityReason
      }),
      effect(() => {
        const label = t('buttons.speed', { factor: mission.clock.speed.value })
        speed.textContent = label
        speed.title = label
      }),
    )
    box.append(go, mine, speed)
    this.el = box
    return box
  }

  onRemove(): void {
    if (this.flying) {
      this.flying = false
      this.flight?.stop()
      endPlayer('flythrough')
    }
    for (const s of this.stops) s()
    this.stops = []
    this.el?.remove()
    this.el = null
  }
}

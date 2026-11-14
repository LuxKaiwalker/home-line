// Storm switch (F18): "replay 20 May 2024 storm during this EVA". The storm's onset is placed on
// the EVA clock at the minute the switch is turned on; the tripwire fires after the same delay as
// in the real series (rad.json storm_2024.tripwire_utc - onset_utc, WS4's rule); from then the
// dose leash counts down from tau_dose at the storm peak (rad.json leash.tau_min_at_peak).
// Arithmetic on values from rad.json only (assumption A-WS7-4, STATUS.md).
import type { Rad } from './types'

export interface StormReplay {
  onT: number // EVA minute the switch was turned on (= storm onset on the EVA clock)
  tripDelayMin: number // tripwire_utc - onset_utc, minutes
  tauDoseMin: number // leash.tau_min_at_peak
}

export interface StormState {
  on: boolean
  fired: boolean
  /** EVA minute the tripwire fires (null = switch off) */
  tFire: number | null
  tauDoseMin: number | null
  /** dose budget left at t (min of exposure at peak rate); null before the tripwire */
  doseLeftMin: number | null
}

/** Build a replay from rad.json; null when rad.json lacks the storm onset, tripwire or tau. */
export function stormReplay(rad: Rad | null, onT: number): StormReplay | null {
  const s = rad?.storm_2024
  const tau = rad?.leash.tau_min_at_peak
  if (!s?.onset_utc || !s.tripwire_utc || tau === null || tau === undefined) return null
  const delay = (Date.parse(s.tripwire_utc) - Date.parse(s.onset_utc)) / 60000
  if (!Number.isFinite(delay) || delay < 0) return null
  return { onT, tripDelayMin: delay, tauDoseMin: tau }
}

export function stormState(r: StormReplay | null, t: number): StormState {
  if (!r) return { on: false, fired: false, tFire: null, tauDoseMin: null, doseLeftMin: null }
  const tFire = r.onT + r.tripDelayMin
  const fired = t >= tFire
  return { on: true, fired, tFire, tauDoseMin: r.tauDoseMin, doseLeftMin: fired ? r.tauDoseMin - (t - tFire) : null }
}

/** Readout input for alarm 2: tripwire fired, compared against the dose budget left. */
export function radiationInput(s: StormState): { tripwireFired: boolean; tauDoseMin: number | null } {
  return { tripwireFired: s.fired, tauDoseMin: s.fired ? s.doseLeftMin : null }
}

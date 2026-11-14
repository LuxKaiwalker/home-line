// Dose-budget leash (F14, D9): tau_dose = D_allow / Ddot. The pipeline writes tau at the storm peak
// for the default allowance (rad.json leash.tau_min_at_peak). The D9 slider changes D_allow, so the
// page recomputes tau with the formula from config/conditions.yaml leash.formula:
//   tau_dose_min = 60 * D_allow / Ddot_mGy_per_h
// from the manifest-backed rate in rad.json; values off the default are labelled "computed in the browser".

/** µGy/day -> mGy/h. */
export function uGyDayToMGyH(rate: number): number {
  return rate / 1000 / 24
}

/** Minutes on a dose allowance D (mGy) at a dose rate (µGy/day); null when the rate is unknown or <= 0. */
export function tauMin(dAllowMgy: number, rateUGyDay: number | null): number | null {
  if (rateUGyDay === null || !(rateUGyDay > 0)) return null
  return (60 * dAllowMgy) / uGyDayToMGyH(rateUGyDay)
}

/** Slider stops between lo and hi (inclusive) at `step`, without float drift. */
export function sliderStops(lo: number, hi: number, step: number): number[] {
  const n = Math.round((hi - lo) / step)
  return Array.from({ length: n + 1 }, (_, i) => +(lo + i * step).toFixed(6))
}

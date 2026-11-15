// I1b: the ONE file between the Edit-route panel and I1a's browser compute core (edit/route/browser/:
// computeBrowserRoute, buildBrowserMission, the data loader). Everything else in instant/ codes against
// types.ts. Until I1a lands on this branch, the core reports itself unavailable (the panel says so and
// keeps every other control).
import type { EstimateCore } from './types'

/** Official-pad fields of the published data (I2 adds the picker pads' fields here). */
export const OFFICIAL_FIELDS = 'fields/index.json'

/**
 * Seam for I2's picker pads: the fields the browser estimate runs on for this pad, or null when the
 * browser has no fields for it (custom spot, a picker pad without fields yet).
 */
export function padFields(padId: string | null, officialPadId: string): string | null {
  return padId !== null && padId === officialPadId ? OFFICIAL_FIELDS : null
}

const NOT_YET = 'the browser compute core (I1a) is not in this build yet'

export const browserCore: EstimateCore = {
  load: () => Promise.reject(new Error(NOT_YET)),
  compute: () => {
    throw new Error(NOT_YET)
  },
  mission: () => {
    throw new Error(NOT_YET)
  },
}

// PORT U4: the export payload: mission.json text + file name for the active plan.
//   user route  -> the core exporter's document for that route (core.ts), JSON.stringify(doc, null, 1)
//                  exactly as the Edit-route export (edit/route/instant/estimate.ts exportMission)
//   no route    -> the official plan of the active pad (core.ts officialMission), the file as published
// File name: homeline-mission-<hash8>.json, hash8 = the first 8 hex of mission_id (m-<12 hex>), else
// FNV-1a of the plan key (= estimate.ts hash8). kind "homeline_mission" and origin_label come from the
// core unchanged (Unity depends on them).
import { encodeRouteParam, type PlanningDoc } from '../../../state/planning'
import { createExportCore, type ExportCore, type MissionDoc } from './core'

export interface ExportPayload {
  /** 'route' = the user's route; 'official' = the official plan of the pad (no user route) */
  source: 'route' | 'official'
  doc: MissionDoc
  /** the file's text (what Download saves and MARVIS receives) */
  text: string
  name: string
}

/** FNV-1a 32 bit as 8 hex characters (file name only; the content hash is mission_id). Same as estimate.ts hash8. */
export function hash8(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/** homeline-mission-<hash8>.json for a mission document; `key` = fallback when mission_id is not m-<hex>. */
export function missionFileName(doc: MissionDoc, key: string): string {
  const id = typeof doc.mission_id === 'string' ? doc.mission_id.replace(/^m-/, '').slice(0, 8) : ''
  return `homeline-mission-${/^[0-9a-f]{8}$/.test(id) ? id : hash8(key)}.json`
}

let defaultCore: ExportCore | null = null
const coreOrDefault = (core?: ExportCore) => core ?? (defaultCore ??= createExportCore())

/** The mission.json of the plan on screen. Throws ExportError (core.ts) with the reason. */
export async function buildExportPayload(plan: PlanningDoc, core?: ExportCore, now?: Date): Promise<ExportPayload> {
  const c = coreOrDefault(core)
  const key = `${plan.padId}:${encodeRouteParam(plan)}`
  if (plan.route.stops.length) {
    const doc = await c.routeMission(plan, now)
    return { source: 'route', doc, text: JSON.stringify(doc, null, 1), name: missionFileName(doc, key) }
  }
  const { doc, text } = await c.officialMission(plan.padId, now)
  return { source: 'official', doc, text: text ?? JSON.stringify(doc, null, 1), name: missionFileName(doc, key) }
}

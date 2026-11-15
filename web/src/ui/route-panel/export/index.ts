// PORT U4: export and share for the Route panel, plus the Plan link redirect logic (router wiring: I1).
//   install()                            mounts ExportSection in U1's panel (section 'export'); returns unregister
//   register(registerRoutePanelSection)  the same with an explicit registrar
//   applyPlanLink(hash)                  I1 calls it from main.ts render() (requests-I1.md "U4")
import type { ComponentType } from 'preact'
import { registerRoutePanelSection } from '../sections'
import { ExportSection } from './ExportSection'

export { ExportSection, exportErrorText, type ExportSectionProps } from './ExportSection'
export { applyPlanLink, browserLinkIO, clearPlanLinkNotice, planLinkNotice, resolvePlanLink, type PlanLinkIO, type PlanLinkNotice, type PlanLinkOutcome, type PlanLinkResolution } from './planLink'
export { buildExportPayload, missionFileName, type ExportPayload } from './payload'
export { createExportCore, ExportError, type ExportCore } from './core'
export { createMarvisTarget, type ExportTarget } from './marvis'
export { copyText, shareUrl } from './share'

/** U1's registerRoutePanelSection (ui/route-panel): name -> component; returns an unregister function. */
export type RegisterRoutePanelSection = (name: 'export', component: ComponentType) => (() => void) | void

/** Mount the export section in the Route panel. */
export function register(registerSection: RegisterRoutePanelSection): (() => void) | void {
  return registerSection('export', ExportSection as ComponentType)
}

/** Mount the export section in U1's Route panel (I1: one call next to the other section installs). */
export const install = (): (() => void) => registerRoutePanelSection('export', ExportSection)

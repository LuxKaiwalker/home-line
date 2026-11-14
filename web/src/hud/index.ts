// WS5 mount slot for /hud (web/src/views/slot.ts): export mount(el, ctx) -> cleanup.
// Config comes from config/hud.yaml and crew.yaml, parsed at build time by WS5's YAML plugin.
// WS8 (3D) reuses the same pieces: loadHudData, computeReadout, createHudPanel, PlaybackClock.
import crewRaw from '../../../config/crew.yaml'
import hudRaw from '../../../config/hud.yaml'
import { parseHudConfig } from './config'
import { mountHud } from './hud'

export { mountHud, loadHudData, type MountHudOptions, type HudHandle, type HudData } from './hud'
export { createHudPanel, type HudPanel, type PanelExtras } from './panel'
export { computeReadout, playbackPosition, type Readout, type HudContext } from './readout'
export { parseHudConfig, type HudConfig } from './config'
export { PlaybackClock } from './clock'
export { driftPosition, planFixes, type Fix } from './drift'
export { stormReplay, stormState, radiationInput } from './storm'
export { hudFrame, takeFixTime, ellipseMax, type HudNav, type HudFrame } from './navhud'
export { PointerField, loadPointer, type WayHome } from './wayhome'
export { fieldGrid, FieldGrid, loadField } from './fields'
export { readoutSources, type PanelRow, type RowSource } from './provenance'
export type { HudPosition } from './types'

export function hudConfigFromYaml() {
  return parseHudConfig(hudRaw, crewRaw)
}

/** Slot contract (WS5 ViewContext): ctx.dataUrl maps a path in the active data tree to a URL. */
export async function mount(el: HTMLElement, ctx: { dataUrl: (path: string) => string }): Promise<() => void> {
  const hud = await mountHud(el, { dataUrl: ctx.dataUrl, config: hudConfigFromYaml() })
  return () => hud.destroy()
}

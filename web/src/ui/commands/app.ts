// App commands (search block S2; docs/design/search.md §3 "Do"): layer toggles, exaggeration, storm replay,
// replay intro, full screen, undo / redo. Each `run` calls an existing store function or a standard browser
// API; nothing runs until a row is chosen. Not here (no callable outside waypoint/live code, or owned by the
// waypoint orchestrator): official plan, copy permalink, export, send to simulator, route, My plans.
import { OVERLAYS } from '../../map/overlays/catalog'
import { overlayOn, resetOverlays, setOverlay } from '../../map/overlays/state'
import { TERRAIN, TERRAIN_PENDING } from '../../map/terrain/config'
import { exaggeration, setExaggeration } from '../../map/terrain/state'
import { mission } from '../../state/mission'
import { ui } from '../../state/ui'
import { modeHash } from '../shell/store'
import { registerCommand, type Command } from './registry'
import { inMapMode, shortcutCommand } from './shell'

export interface AppCommandEnv {
  /** Default: the page's document / location (tests pass fakes). */
  doc?: Pick<Document, 'fullscreenEnabled' | 'fullscreenElement' | 'documentElement' | 'exitFullscreen'> | null
  location?: Pick<Location, 'href' | 'assign'> | null
}

const in3d = (): boolean => inMapMode() && ui.view.value === '3d'

/** The app commands available in this build, in palette order. */
export function appCommands(e: AppCommandEnv = {}): Command[] {
  const doc = e.doc !== undefined ? e.doc : typeof document === 'undefined' ? null : document
  const loc = e.location !== undefined ? e.location : typeof location === 'undefined' ? null : location
  const mapOnly = { enabled: inMapMode, reason: () => 'commands.reason.mapOnly' as const }
  const only3d = { enabled: in3d, reason: () => 'commands.reason.only3d' as const }
  const out: Command[] = [
    // one toggle per overlay of the layer panel (map/overlays/catalog.ts); setOverlay applies the thematic cap
    ...OVERLAYS.map((o): Command => ({
      id: `map.layer.${o.id}`,
      label: `commands.layer.${o.id}`, // "Layer: …": the layer panel name with context
      keywords: ['layer', 'overlay', 'show', 'hide', 'toggle', o.id.toLowerCase()],
      icon: 'layers',
      group: 'map',
      owner: 'design',
      run: () => setOverlay(o.id, !overlayOn.peek()[o.id]),
      ...mapOnly,
    })),
    {
      id: 'map.layers.reset',
      label: 'commands.layersReset',
      keywords: ['layer', 'overlay', 'reset', 'hide', 'clear'],
      icon: 'eye-off',
      group: 'map',
      owner: 'design',
      run: () => resetOverlays(),
      ...mapOnly,
    },
    {
      id: 'map.exaggeration.more',
      label: 'commands.exaggeration.more',
      keywords: ['exaggeration', 'terrain', 'relief', 'height', '3d', 'more'],
      icon: 'mountain',
      group: 'map',
      owner: 'design',
      run: () => setExaggeration(exaggeration() + TERRAIN_PENDING.exaggerationStep),
      ...only3d,
    },
    {
      id: 'map.exaggeration.less',
      label: 'commands.exaggeration.less',
      keywords: ['exaggeration', 'terrain', 'relief', 'height', '3d', 'less', 'flatter'],
      icon: 'mountain',
      group: 'map',
      owner: 'design',
      run: () => setExaggeration(exaggeration() - TERRAIN_PENDING.exaggerationStep),
      ...only3d,
    },
    {
      id: 'map.exaggeration.reset',
      label: 'commands.exaggeration.reset',
      keywords: ['exaggeration', 'terrain', 'relief', 'true', 'shape', 'reset', '3d'],
      icon: 'mountain',
      group: 'map',
      owner: 'design',
      run: () => setExaggeration(TERRAIN.exaggeration.default),
      ...only3d,
    },
    // the planning map's storm switch (map/storm StormControl) flips this signal; its effect starts / stops the replay
    {
      id: 'story.storm',
      label: 'commands.storm',
      keywords: ['storm', 'radiation', 'replay', 'solar', 'particle', 'event'],
      icon: 'radiation',
      group: 'story',
      owner: 'design',
      run: () => void (mission.conditions.storm.value = !mission.conditions.storm.peek()),
      ...mapOnly,
    },
    // undo / redo: the plan-edit store answers the shell's `hl:shortcut` (edit/bind.ts), as for Ctrl+Z
    shortcutCommand({ id: 'edit.undo', label: 'buttons.undo', keywords: ['undo', 'revert', 'edit'], icon: 'undo-2', group: 'plan', shortcut: { action: 'undo' }, ...mapOnly }),
    shortcutCommand({ id: 'edit.redo', label: 'buttons.redo', keywords: ['redo', 'edit'], icon: 'redo-2', group: 'plan', shortcut: { action: 'redo' }, ...mapOnly }),
  ]
  // replay intro: the planning map plays the intro for `?intro=1` (story/query.ts); reduced motion never plays it
  if (loc)
    out.push({
      id: 'story.intro',
      label: 'buttons.replayIntro',
      keywords: ['intro', 'replay', 'story', 'tour', 'start'],
      icon: 'play',
      group: 'story',
      owner: 'design',
      enabled: () => !ui.reducedMotion.value,
      reason: () => 'commands.reason.reducedMotion',
      run: () => {
        const u = new URL(loc.href)
        u.searchParams.set('intro', '1')
        u.hash = modeHash('plan')
        loc.assign(u.toString())
      },
    })
  // full screen: only where the browser allows it (no dead row)
  if (doc?.fullscreenEnabled)
    out.push({
      id: 'view.fullscreen',
      label: 'commands.fullscreen',
      keywords: ['full', 'screen', 'fullscreen', 'present', 'maximize'],
      icon: 'maximize',
      group: 'view',
      owner: 'design',
      run: () => (doc.fullscreenElement ? doc.exitFullscreen() : doc.documentElement.requestFullscreen()).catch(() => {}), // refused: nothing changes
    })
  return out
}

/** Register the app commands once; returns dispose. */
export function installAppCommands(e: AppCommandEnv = {}): () => void {
  const offs = appCommands(e).map(registerCommand)
  return () => offs.forEach((f) => f())
}

// S2 shell and app commands (docs/design/search.md §3, §5, §6 "Registry"):
//  - every registered command's run calls the right store function or keys.ts action (spies), and
//    registering or typing (ranking) calls none of them;
//  - the keys.ts adapter: keysForAction reads HELP_ROWS; runShortcut's default branch delegates to a
//    registered non-shell command only, so an unhandled camera / undo never recurses;
//  - every HELP_ROWS keyboard row (except search and Esc) has a command; ids are unique;
//  - keystroke latency: rank() over objects + all commands padded to ≥ 2,000 items, median of 50 < 16 ms.
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { OVERLAYS } from '../../map/overlays/catalog'
import { overlayOn, resetOverlays, setOverlay } from '../../map/overlays/state'
import { TERRAIN, TERRAIN_PENDING } from '../../map/terrain/config'
import { exaggeration, setExaggeration } from '../../map/terrain/state'
import { mission } from '../../state/mission'
import { resetSelection, select, stepHistory } from '../../state/selection'
import { ui } from '../../state/ui'
import { t } from '../copy'
import { buildObjectIndex, commandItems, rank, type LabelLike, type SearchItem } from '../search/search'
import { HELP_ROWS, keysForAction, runShortcut, type ShortcutAction } from '../shell/keys'
import { shell } from '../shell/store'
import { appCommands, installAppCommands } from './app'
import { commands, getCommand, registerCommand, resetCommands, runCommand } from './registry'
import { installShellCommands, setCommandEnv } from './shell'

vi.mock('../shell/keys', async (orig) => {
  const m = await orig<typeof import('../shell/keys')>()
  return { ...m, runShortcut: vi.fn(m.runShortcut) }
})
vi.mock('../../map/overlays/state', async (orig) => {
  const m = await orig<typeof import('../../map/overlays/state')>()
  return { ...m, setOverlay: vi.fn(m.setOverlay), resetOverlays: vi.fn(m.resetOverlays) }
})
vi.mock('../../map/terrain/state', async (orig) => {
  const m = await orig<typeof import('../../map/terrain/state')>()
  return { ...m, setExaggeration: vi.fn(m.setExaggeration) }
})

const runShortcutSpy = vi.mocked(runShortcut)
const spies = [runShortcutSpy, vi.mocked(setOverlay), vi.mocked(resetOverlays), vi.mocked(setExaggeration)]

let win: EventTarget
let nav: Mock<(hash: string) => void>
const announced: ShortcutAction[] = []
const fakeDoc = () => {
  const d = {
    fullscreenEnabled: true,
    fullscreenElement: null as unknown,
    exitFullscreen: vi.fn(() => Promise.resolve()),
    documentElement: { requestFullscreen: vi.fn(() => Promise.resolve()) },
  }
  return d
}
const fakeLoc = () => ({ href: 'https://example.test/home-line/?legacy=0#/report', assign: vi.fn() })

function install(e: Parameters<typeof appCommands>[0] = {}) {
  installShellCommands()
  installAppCommands(e)
}

beforeEach(() => {
  resetCommands()
  win = new EventTarget()
  announced.length = 0
  win.addEventListener('hl:shortcut', (e) => announced.push((e as CustomEvent<ShortcutAction>).detail))
  nav = vi.fn<(hash: string) => void>()
  setCommandEnv({ win: win as Window, navigate: nav })
  ui.mode.value = 'plan'
  ui.view.value = '2d'
  ui.reducedMotion.value = false
  shell.helpOpen.value = false
  shell.focusMode.value = false
  resetSelection()
  mission.conditions.storm.value = false
  for (const s of spies) s.mockClear()
})
afterEach(() => resetCommands())

describe('registration', () => {
  it('registers every §3 command S2 owns exactly once; registering and ranking call no store function', () => {
    const doc = fakeDoc()
    const loc = fakeLoc()
    install({ doc: doc as never, location: loc })
    const ids = commands.value.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    const expected = [
      'mode.plan', 'mode.fly', 'mode.report', 'view.toggle3d', 'view.focusMode', 'timeline.playPause', 'timeline.back', 'timeline.forward',
      'camera.overhead', 'camera.isometric', 'camera.low', 'camera.focus', 'camera.follow', 'selection.back', 'selection.forward', 'app.help',
      ...OVERLAYS.map((o) => `map.layer.${o.id}`), 'map.layers.reset', 'map.exaggeration.more', 'map.exaggeration.less', 'map.exaggeration.reset',
      'story.storm', 'edit.undo', 'edit.redo', 'story.intro', 'view.fullscreen',
    ] // prettier-ignore
    expect([...ids].sort()).toEqual([...expected].sort())
    // never registered by S2: waypoint-owned or no callable outside live/edit-route code
    for (const id of ['route.open', 'route.compute', 'plan.exportJson', 'sim.send', 'plans.open', 'plan.copyPermalink', 'plan.official', 'escape', 'search']) expect(ids).not.toContain(id)
    const items = commandItems()
    for (const q of ['l', 'la', 'lay', 'laye', 'layer', '3', '3d', 'undo', 'storm', 'camera low', 'full', 'intro', 'ridge', 'exag']) rank(items, q, (i) => (i.label ? t(i.label) : i.name))
    for (const s of spies) expect(s).not.toHaveBeenCalled()
    expect(nav).not.toHaveBeenCalled()
    expect(announced).toEqual([])
    expect(loc.assign).not.toHaveBeenCalled()
    expect(doc.documentElement.requestFullscreen).not.toHaveBeenCalled()
    expect(mission.conditions.storm.value).toBe(false)
  })

  it('no dead rows: full screen only where the browser allows it; intro only with a location', () => {
    expect(appCommands({ doc: { ...fakeDoc(), fullscreenEnabled: false } as never, location: null }).map((c) => c.id)).not.toContain('view.fullscreen')
    expect(appCommands({ doc: null, location: null }).map((c) => c.id)).not.toContain('story.intro')
  })

  it('labels are copy keys that resolve; no number in a command label', () => {
    install({ doc: fakeDoc() as never, location: fakeLoc() })
    for (const c of commands.value) expect(t(c.label).replace(/\b[23]D\b/g, ''), c.id).not.toMatch(/\d/) // "2D / 3D" names the view, not a value
  })

  it('every HELP_ROWS keyboard row except search and Esc has a command answering it', () => {
    install()
    const ACTION: Record<string, ShortcutAction['action']> = { cameraPresets: 'camera', focusMode: 'focusMode', playPause: 'playPause', scrub: 'scrub', undoRedo: 'undo', history: 'history', modes: 'mode', toggle3d: 'toggle3d', help: 'help' }
    const keyboard = HELP_ROWS.filter((r) => !/^shortcuts\.(mouse|touch|search|escape)/.test(r.label)).map((r) => r.label.replace('shortcuts.', ''))
    const covered = new Set(commands.value.flatMap((c) => (c.shortcut ? [c.shortcut.action] : [])))
    for (const l of keyboard) expect(covered, l).toContain(ACTION[l])
    // and the keys each command shows are keys of its HELP_ROWS row
    for (const c of commands.value) if (c.shortcut) for (const k of keysForAction(c.shortcut)) expect(HELP_ROWS.some((r) => r.keys.some((x) => k.endsWith(x) || (/^\d$/.test(k) && x.includes('5')))), `${c.id} ${k}`).toBe(true)
  })
})

describe('shell commands run the keys.ts action', () => {
  it('each one calls runShortcut with its action and the shell handles it as the key would', () => {
    install()
    ui.mode.value = 'fly'
    select({ kind: 'station', id: 'S1' })
    select({ kind: 'station', id: 'S2' })
    select({ kind: 'station', id: 'S1' })
    stepHistory(-1) // a forward entry exists too
    const shellCmds = commands.value.filter((c) => c.owner === 'shell')
    expect(shellCmds.length).toBeGreaterThan(15)
    for (const c of shellCmds) {
      runShortcutSpy.mockClear()
      expect(runCommand(c.id, 'palette'), c.id).toBe(c.enabled ? c.enabled() : true)
      if (c.enabled && !c.enabled()) continue
      expect(runShortcutSpy, c.id).toHaveBeenCalledTimes(1)
      expect(runShortcutSpy.mock.calls[0][0], c.id).toEqual(c.shortcut)
    }
    // announced like the key, so the camera, sidebar and plan-edit listeners answer
    expect(announced).toContainEqual({ action: 'camera', preset: 5 })
    expect(announced).toContainEqual({ action: 'undo' })
  })

  it('mode navigates; 2D/3D, help and focus mode flip the shell state', () => {
    install()
    expect(runCommand('mode.report', 'palette')).toBe(true)
    expect(nav).toHaveBeenCalledTimes(1)
    runCommand('view.toggle3d', 'palette')
    expect(ui.view.value).toBe('3d')
    runCommand('app.help', 'palette')
    expect(shell.helpOpen.value).toBe(true)
    runCommand('view.focusMode', 'palette')
    expect(shell.focusMode.value).toBe(true)
  })

  it('FLY-only, map-only and history commands are disabled with their reason elsewhere', () => {
    install()
    ui.mode.value = 'report'
    for (const [id, reason] of [
      ['timeline.playPause', 'commands.reason.flyOnly'],
      ['camera.low', 'commands.reason.mapOnly'],
      ['selection.back', 'commands.reason.noHistory'],
      ['map.exaggeration.more', 'commands.reason.only3d'],
    ] as const) {
      expect(runCommand(id, 'palette'), id).toBe(false)
      expect(getCommand(id)!.reason!(), id).toBe(reason)
    }
    expect(runShortcutSpy).not.toHaveBeenCalled()
  })
})

describe('app commands call the store functions', () => {
  it('layer toggles: setOverlay(id, !on); reset: resetOverlays()', () => {
    install()
    for (const o of OVERLAYS) {
      vi.mocked(setOverlay).mockClear()
      const was = overlayOn.peek()[o.id]
      expect(runCommand(`map.layer.${o.id}`, 'palette')).toBe(true)
      expect(setOverlay).toHaveBeenCalledExactlyOnceWith(o.id, !was)
    }
    runCommand('map.layers.reset', 'palette')
    expect(resetOverlays).toHaveBeenCalledTimes(1)
  })

  it('exaggeration: ± the design.yaml step, reset to the default; only in 3D', () => {
    install()
    expect(runCommand('map.exaggeration.more', 'palette')).toBe(false)
    ui.view.value = '3d'
    const x = exaggeration()
    runCommand('map.exaggeration.more', 'palette')
    expect(setExaggeration).toHaveBeenLastCalledWith(x + TERRAIN_PENDING.exaggerationStep)
    const y = exaggeration()
    runCommand('map.exaggeration.less', 'palette')
    expect(setExaggeration).toHaveBeenLastCalledWith(y - TERRAIN_PENDING.exaggerationStep)
    runCommand('map.exaggeration.reset', 'palette')
    expect(setExaggeration).toHaveBeenLastCalledWith(TERRAIN.exaggeration.default)
  })

  it('storm flips the storm switch signal; undo / redo announce the shortcut for the plan-edit store', () => {
    install()
    runCommand('story.storm', 'palette')
    expect(mission.conditions.storm.value).toBe(true)
    runCommand('story.storm', 'palette')
    expect(mission.conditions.storm.value).toBe(false)
    runCommand('edit.undo', 'palette')
    runCommand('edit.redo', 'palette')
    expect(runShortcutSpy.mock.calls.map((c) => c[0])).toEqual([{ action: 'undo' }, { action: 'redo' }])
    expect(announced).toEqual([{ action: 'undo' }, { action: 'redo' }])
  })

  it('intro: reloads the plan view with ?intro=1 (not with reduced motion); full screen toggles', () => {
    const doc = fakeDoc()
    const loc = fakeLoc()
    install({ doc: doc as never, location: loc })
    ui.reducedMotion.value = true
    expect(runCommand('story.intro', 'palette')).toBe(false)
    expect(getCommand('story.intro')!.reason!()).toBe('commands.reason.reducedMotion')
    ui.reducedMotion.value = false
    runCommand('story.intro', 'palette')
    expect(loc.assign).toHaveBeenCalledTimes(1)
    const u = new URL(loc.assign.mock.calls[0][0] as string)
    expect(u.searchParams.get('intro')).toBe('1')
    expect(u.searchParams.get('legacy')).toBe('0')
    runCommand('view.fullscreen', 'palette')
    expect(doc.documentElement.requestFullscreen).toHaveBeenCalledTimes(1)
    doc.fullscreenElement = {}
    runCommand('view.fullscreen', 'palette')
    expect(doc.exitFullscreen).toHaveBeenCalledTimes(1)
  })
})

describe('keys.ts adapter', () => {
  it('keysForAction reads HELP_ROWS', () => {
    expect(keysForAction({ action: 'mode', mode: 'plan' })).toEqual(['P'])
    expect(keysForAction({ action: 'mode', mode: 'report' })).toEqual(['R'])
    expect(keysForAction({ action: 'toggle3d' })).toEqual(['T'])
    expect(keysForAction({ action: 'search' })).toEqual(['Ctrl+K', '/'])
    expect(keysForAction({ action: 'undo' })).toEqual(['Ctrl+Z'])
    expect(keysForAction({ action: 'redo' })).toEqual(['Ctrl+Shift+Z'])
    expect(keysForAction({ action: 'history', step: -1 })).toEqual(['['])
    expect(keysForAction({ action: 'history', step: 1 })).toEqual([']'])
    expect(keysForAction({ action: 'scrub', minutes: -1 })).toEqual(['←'])
    expect(keysForAction({ action: 'scrub', minutes: 10 })).toEqual(['Shift+→'])
    expect(keysForAction({ action: 'camera', preset: 3 })).toEqual(['3'])
    expect(keysForAction({ action: 'playPause' })).toEqual(['Space'])
    expect(keysForAction({ action: 'help' })).toEqual(['?'])
    expect(keysForAction({ action: 'focusMode' })).toEqual(['F'])
    for (const r of HELP_ROWS) for (const k of r.keys) expect(typeof k).toBe('string')
  })

  const env = () => ({ navigate: vi.fn(), announce: vi.fn(() => false) })

  it('unhandled camera / undo / history with shell commands registered: false, no recursion', () => {
    install()
    ui.mode.value = 'plan'
    for (const a of [{ action: 'camera', preset: 1 }, { action: 'camera', preset: 5 }, { action: 'undo' }, { action: 'redo' }, { action: 'history', step: -1 }] as ShortcutAction[]) {
      runShortcutSpy.mockClear()
      const e = env()
      expect(runShortcut(a, e)).toBe(false)
      expect(runShortcutSpy).toHaveBeenCalledTimes(1)
      expect(e.announce).toHaveBeenCalledTimes(1)
    }
  })

  it('an unhandled action runs its registered non-shell command (enabled only); a handled one does not', () => {
    const run = vi.fn()
    let on = true
    registerCommand({ id: 'design.camera3', label: 'commands.camera.low', icon: 'camera', group: 'map', owner: 'design', shortcut: { action: 'camera', preset: 3 }, enabled: () => on, run })
    expect(runShortcut({ action: 'camera', preset: 3 }, env())).toBe(true)
    expect(run).toHaveBeenCalledWith('shortcut')
    on = false
    expect(runShortcut({ action: 'camera', preset: 3 }, env())).toBe(false)
    on = true
    expect(runShortcut({ action: 'camera', preset: 3 }, { navigate: vi.fn(), announce: () => true })).toBe(true)
    expect(run).toHaveBeenCalledTimes(1)
    expect(runShortcut({ action: 'camera', preset: 2 }, env())).toBe(false)
  })
})

describe('keystroke latency', () => {
  it('rank() over objects + all commands padded to ≥ 2,000 items: median of 50 keystrokes < 16 ms', () => {
    install({ doc: fakeDoc() as never, location: fakeLoc() })
    const REAL = resolve(__dirname, '../../../public/data/labels.json')
    const labels: LabelLike[] = existsSync(REAL) ? JSON.parse(readFileSync(REAL, 'utf8')).labels : []
    const base: SearchItem[] = [...buildObjectIndex(labels), ...commandItems()]
    const items: SearchItem[] = []
    for (let k = 0; items.length < 2000; k++) for (const i of base) items.push({ ...i, id: `${i.id}#${k}`, code: k ? `${i.code}${k}` : i.code })
    expect(items.length).toBeGreaterThanOrEqual(2000)
    const label = (i: SearchItem) => (i.label ? t(i.label) : i.name)
    const words = ['layer', '3d', 'toggle ridges', 'camera low', 'undo', 'storm', 'exaggeration', 's7', 'full screen', 'intro']
    const keystrokes = words.flatMap((w) => [...w].map((_, n) => w.slice(0, n + 1)))
    for (const q of keystrokes.slice(0, 20)) rank(items, q, label) // warm-up
    const times = keystrokes.slice(0, 50).map((q) => {
      const t0 = performance.now()
      rank(items, q, label)
      return performance.now() - t0
    })
    expect(times).toHaveLength(50)
    const sorted = [...times].sort((a, b) => a - b)
    const median = sorted[25]
    console.info(`S2 latency: ${items.length} items, median ${median.toFixed(2)} ms, max ${sorted[49].toFixed(2)} ms`)
    expect(median).toBeLessThan(16)
  })
})

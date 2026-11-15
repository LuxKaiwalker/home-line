// S2 command registry (docs/design/search.md §5, §6 "Registry" and "Live / offline"): register / dispose,
// duplicate ids, enabled state and its reason (live first), runCommand on a disabled command, shortcut
// matching with the action's parameter, and the import rule (design rule 6: ui/commands and ui/search
// never import web/src/live/ or web/src/edit/route/).
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { signal } from '../../state/signal'
import { commandForShortcut, commands, getCommand, isEnabled, liveStatus, reasonFor, registerCommand, resetCommands, runCommand, setLiveStatus, type Command } from './registry'

const cmd = (over: Partial<Command> = {}): Command => ({ id: 'x.test', label: 'buttons.undo', icon: 'undo-2', group: 'app', owner: 'search', run: vi.fn(), ...over })

afterEach(() => resetCommands())

describe('registry', () => {
  it('register adds in order; dispose removes; getCommand finds by id', () => {
    const offA = registerCommand(cmd({ id: 'a' }))
    registerCommand(cmd({ id: 'b' }))
    expect(commands.value.map((c) => c.id)).toEqual(['a', 'b'])
    expect(getCommand('b')?.id).toBe('b')
    offA()
    expect(commands.value.map((c) => c.id)).toEqual(['b'])
    offA() // twice is harmless
    expect(commands.value.map((c) => c.id)).toEqual(['b'])
    expect(getCommand('a')).toBeUndefined()
  })

  it('a duplicate id throws in dev and tests', () => {
    registerCommand(cmd({ id: 'dup' }))
    expect(() => registerCommand(cmd({ id: 'dup' }))).toThrow(/dup/)
    expect(commands.value).toHaveLength(1)
  })

  it('enabled / reason follow the command signals; runCommand is a no-op (false) while disabled', () => {
    const on = signal(false)
    const run = vi.fn()
    registerCommand(cmd({ id: 'c', run, enabled: () => on.value, reason: () => 'commands.reason.flyOnly' }))
    const c = getCommand('c')!
    expect(isEnabled(c)).toBe(false)
    expect(reasonFor(c)).toBe('commands.reason.flyOnly')
    expect(runCommand('c', 'palette')).toBe(false)
    expect(run).not.toHaveBeenCalled()
    on.value = true
    expect(isEnabled(c)).toBe(true)
    expect(reasonFor(c)).toBeNull()
    expect(runCommand('c', 'menu')).toBe(true)
    expect(run).toHaveBeenCalledWith('menu')
    expect(runCommand('nope', 'palette')).toBe(false)
  })

  it('live-only: default status is "not reachable, unknown"; the live reason comes first; reachable enables it', () => {
    expect(liveStatus.value).toEqual({ reachable: false, reason: 'search.live.unknown' })
    const run = vi.fn()
    registerCommand(cmd({ id: 'route.compute', live: true, run, enabled: () => false, reason: () => 'commands.reason.mapOnly' }))
    const c = getCommand('route.compute')!
    expect(isEnabled(c)).toBe(false)
    expect(reasonFor(c)).toBe('search.live.unknown')
    setLiveStatus({ reachable: false, reason: 'search.live.offline' })
    expect(reasonFor(c)).toBe('search.live.offline')
    expect(runCommand('route.compute', 'palette')).toBe(false)
    setLiveStatus({ reachable: true, reason: null })
    expect(reasonFor(c)).toBe('commands.reason.mapOnly') // then its own reason
    registerCommand(cmd({ id: 'live.ok', live: true, run }))
    expect(runCommand('live.ok', 'palette')).toBe(true)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('commandForShortcut matches the action and its parameter', () => {
    registerCommand(cmd({ id: 'cam1', shortcut: { action: 'camera', preset: 1 } }))
    registerCommand(cmd({ id: 'cam5', shortcut: { action: 'camera', preset: 5 } }))
    registerCommand(cmd({ id: 'back', shortcut: { action: 'history', step: -1 } }))
    expect(commandForShortcut({ action: 'camera', preset: 5 })?.id).toBe('cam5')
    expect(commandForShortcut({ action: 'camera', preset: 3 })).toBeUndefined()
    expect(commandForShortcut({ action: 'history', step: -1 })?.id).toBe('back')
    expect(commandForShortcut({ action: 'history', step: 1 })).toBeUndefined()
    expect(commandForShortcut({ action: 'toggle3d' })).toBeUndefined()
  })
})

describe('imports (design rule 6)', () => {
  const SRC = resolve(__dirname, '../..')
  const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : []))
  // One exception (S3a, team lead order): the route builder's adapter loads WP12's setRouteDraft from
  // edit/route/store with a dynamic import() behind the VITE_LIVE build flag (liveBuild()), so the static
  // build holds no edit code. Allowed for exactly that file, that path, as import() on a liveBuild()-gated
  // line, once. Static imports of live/ or edit/route/ stay forbidden everywhere, routeAdapter.ts included.
  const ADAPTER = join('ui', 'search', 'queries', 'routeAdapter.ts')
  it('ui/commands and ui/search import nothing from live/ or edit/route/', () => {
    let exceptions = 0
    for (const f of [...files(join(SRC, 'ui/commands')), ...files(join(SRC, 'ui/search'))]) {
      const src = readFileSync(f, 'utf8')
      for (const m of src.matchAll(/(?:from\s+|import\()\s*['"]([^'"]+)['"]/g)) {
        const line = src.slice(src.lastIndexOf('\n', m.index) + 1, src.indexOf('\n', m.index))
        if (f.endsWith(ADAPTER) && m[0].startsWith('import(') && m[1] === '../../../edit/route/store' && /liveBuild\(\)\s*\?/.test(line)) {
          exceptions++
          continue
        }
        expect(m[1], `${f} imports ${m[1]}`).not.toMatch(/(^|\/)live(\/|$)|edit\/route/)
      }
    }
    expect(exceptions).toBe(1)
  })
})

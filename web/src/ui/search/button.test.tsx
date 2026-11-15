// S2: the search button (always in the shell's top bar) installs the command registry once per page, lazily,
// and never uninstalls it: mounting it again (re-render, focus mode) neither double-registers nor drops commands.
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { commands, getCommand } from '../commands/registry'
import { installDom, type FakeNode } from '../testing/dom'
import { installCommandsOnce, SearchButton } from './button'

let root: FakeNode
const settle = () => act(async () => void (await installCommandsOnce(new EventTarget() as unknown as Window)))
afterEach(() => act(() => render(null, root as unknown as Element)))

describe('search button installs the commands', () => {
  it('mounting installs them once; a second mount or an unmount keeps exactly one copy', async () => {
    ;({ container: root } = installDom())
    const win = new EventTarget() as unknown as Window
    expect(commands.value).toHaveLength(0) // nothing at import time
    act(() => render(<SearchButton win={win} />, root as unknown as Element))
    await settle()
    const n = commands.value.length
    expect(n).toBeGreaterThan(20)
    expect(getCommand('view.toggle3d')).toBeDefined()
    act(() => render(null, root as unknown as Element))
    expect(commands.value).toHaveLength(n) // unmount keeps them
    act(() => render(<SearchButton win={win} />, root as unknown as Element))
    await settle()
    expect(commands.value).toHaveLength(n)
    expect(new Set(commands.value.map((c) => c.id)).size).toBe(n)
  })
})

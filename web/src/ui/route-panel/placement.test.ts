// PORT F6: the Route panel sits LEFT of the map-edge tool column (zoom, compass, layers, 2D/3D, …), which
// stays at the map's right edge; the drawer's measured box still covers panel + column (map inset).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')

describe('Route panel placement (F6)', () => {
  it('keeps a transparent, click-through strip as wide as the tool column at the map edge', () => {
    const css = read('./routePanel.css')
    expect(css).toMatch(/\.hl-lay-drawer\.hl-rp \{[^}]*--hl-rp-edge: calc\(var\(--plan-tools-w, 0px\)/)
    expect(css).toMatch(/\.hl-lay-drawer\.hl-rp \{[^}]*border-right: var\(--hl-rp-edge\) solid transparent;/)
    expect(css).toMatch(/\.hl-lay-drawer\.hl-rp \{[^}]*background-clip: padding-box;/)
    expect(css).toMatch(/\.hl-lay-drawer\.hl-rp \{[^}]*pointer-events: none;/)
    expect(css).toMatch(/\.hl-lay-drawer\.hl-rp > \* \{ pointer-events: auto; \}/)
  })
  it('the tool column stays at the map edge while the Route panel is open', () => {
    const src = read('../../views/planLayers.tsx')
    expect(src).toMatch(/const toolsRight = rpOpen \? 0 : insets\.right/)
    expect(read('../../views/planChrome.tsx')).toMatch(/--plan-tools-w/)
  })
})

// PORT P2: test fakes (imported by the tests only).
import { FIELD_LAYER, type SwapMap } from './swap'

export function fakeSwapMap(layers = ['band-opt', 'band-con', 'band-lines', 'edges-line', 'partner-line', FIELD_LAYER]) {
  const drawn: Record<string, unknown> = {}
  const calls: string[] = []
  class Src {
    id: string
    constructor(id: string) {
      this.id = id
    }
    setData(d: unknown) {
      drawn[this.id] = d
      return this
    }
  }
  const sources: Record<string, Src> = {}
  for (const id of ['bands', 'iso', 'edges', 'partner', 'route']) sources[id] = new Src(id)
  const layout: Record<string, unknown> = {}
  const paint: Record<string, unknown> = { 'band-opt|fill-opacity': 0.35 }
  const map: SwapMap = {
    getSource: (id) => sources[id],
    getLayer: (id) => (layers.includes(id) ? { id } : undefined),
    getLayoutProperty: (id, k) => layout[`${id}|${k}`],
    setLayoutProperty: (id, k, v) => void (layout[`${id}|${k}`] = v),
    getPaintProperty: (id, k) => paint[`${id}|${k}`],
    setPaintProperty: (id, k, v) => {
      paint[`${id}|${k}`] = v
      calls.push(`${id}|${k}=${JSON.stringify(v)}`)
    },
  }
  return { map, sources, drawn, layout, paint, calls }
}

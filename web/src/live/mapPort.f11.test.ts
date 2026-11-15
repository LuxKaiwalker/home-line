// PORT F11: a map click a map edit handler consumed (R3 added a route point; preventDefault on the DOM
// event) drops no live pad dot; an unconsumed click still does.
import { describe, expect, it } from 'vitest'
import { consoleMapPort, type ConsoleMapLike } from './mapPort'

describe('F11: live pad tool and consumed clicks', () => {
  it('skips a click whose DOM event was consumed', () => {
    const hs: ((e: unknown) => void)[] = []
    const map = { on: (_t: string, f: (e: unknown) => void) => void hs.push(f), off: () => {} }
    const pads: unknown[] = []
    const off = consoleMapPort({ map } as unknown as ConsoleMapLike).onClick((p) => pads.push(p))
    const fire = (defaultPrevented: boolean) => hs.forEach((h) => h({ lngLat: { lng: 137.4, lat: -4.78 }, originalEvent: { defaultPrevented } }))
    fire(true)
    expect(pads).toEqual([])
    fire(false)
    expect(pads).toEqual([{ lon: 137.4, lat: -4.78 }])
    off()
  })
})

// L2e (D111) known answers for the selection pop-up card (ui/cards/selectionCard.tsx):
//  - selection → card: stations keep the 'station' card (L5 id), every other kind the 'selection' card;
//  - title: the object's code and name where known, else its kind (copy deck);
//  - anchor: the object's own point (pad, parking option, station, scored site, landmark, cell, edge
//    pick), the middle of a leg, else the fallback (where the map was clicked);
//  - placement: with cardRoom's size, L1's placeCard (flip, then clamp inside the map) never puts the
//    card over the selected point, wherever the point is in the map.
import { describe, expect, it } from 'vitest'
import type { SelectionRef } from '../../state/selection'
import { t } from '../copy'
import { placeCard } from '../layout'
import { TOKENS } from '../tokens'
import { anchorLngLat, CARD_MIN_W, cardIdFor, cardRoom, cardTitle, SELECTION_CARD, STATION_CARD, type CardSources } from './selectionCard'

const src: CardSources = {
  stations: [{ id: 'S7', name: 'Ridge base', lon: 137.41, lat: -4.62 }],
  labels: [
    { code: 'GDV', name: 'Glen Dessert Valley', kind: 'landmark', lon: 137.38, lat: -4.66 },
    { code: 'X3', name: 'Clay seep', kind: 'scored_site', lon: 137.36, lat: -4.69 },
  ],
  pad: { lon: 137.4, lat: -4.65 },
  padOptions: [{ id: 'rank2', lon: 137.39, lat: -4.64 }],
  route: {
    features: [{ geometry: { type: 'LineString', coordinates: [[137.4, -4.65], [137.405, -4.64], [137.41, -4.62]] }, properties: { leg: 1, from: 'pad', to: 'S7' } }],
  },
}

describe('selection → card', () => {
  it('stations keep the station card; every other kind opens the selection card', () => {
    expect(cardIdFor({ kind: 'station', id: 'S7' })).toBe(STATION_CARD)
    expect(cardIdFor({ kind: 'station', id: 'X3' })).toBe(STATION_CARD) // a scored site is a station ref
    for (const r of [
      { kind: 'pad', id: 'rank1' },
      { kind: 'pad', id: 'rank2' },
      { kind: 'landmark', code: 'GDV' },
      { kind: 'cell', lon: 1, lat: 2 },
      { kind: 'leg', leg: 1 },
      { kind: 'edge', cause: 'slope', budget: 30 },
    ] as SelectionRef[])
      expect(cardIdFor(r)).toBe(SELECTION_CARD)
  })

  it('titles name the object', () => {
    expect(cardTitle({ kind: 'station', id: 'S7' }, src)).toBe('S7 Ridge base')
    expect(cardTitle({ kind: 'station', id: 'X3' }, src)).toBe('X3 Clay seep')
    expect(cardTitle({ kind: 'station', id: 'X9' }, src)).toBe(`${t('cards.station.title')} X9`)
    expect(cardTitle({ kind: 'pad', id: 'rank1' }, src)).toBe(t('cards.pad.officialTitle'))
    expect(cardTitle({ kind: 'pad', id: 'rank2' }, src)).toBe(t('cards.pad.alternativeTitle'))
    expect(cardTitle({ kind: 'landmark', code: 'GDV' }, src)).toBe('GDV Glen Dessert Valley')
    expect(cardTitle({ kind: 'landmark', code: 'ZZ' })).toBe(`${t('cards.landmark.title')} ZZ`)
    expect(cardTitle({ kind: 'cell', lon: 1, lat: 2 })).toBe(t('cards.cell.title'))
    expect(cardTitle({ kind: 'leg', leg: 1 })).toBe(t('cards.route.title'))
    expect(cardTitle({ kind: 'edge', cause: 'data', budget: 30 })).toBe(t('cards.homelineEdge.title'))
  })

  it('anchors at the object: pad, parking option, station, scored site, landmark, cell, edge pick, leg middle; else the click', () => {
    const fb: [number, number] = [0, 0]
    expect(anchorLngLat({ kind: 'pad', id: 'rank1' }, src, fb)).toEqual([137.4, -4.65])
    expect(anchorLngLat({ kind: 'pad', id: 'rank2' }, src, fb)).toEqual([137.39, -4.64])
    expect(anchorLngLat({ kind: 'station', id: 'S7' }, src, fb)).toEqual([137.41, -4.62])
    expect(anchorLngLat({ kind: 'station', id: 'X3' }, src, fb)).toEqual([137.36, -4.69])
    expect(anchorLngLat({ kind: 'landmark', code: 'GDV' }, src, fb)).toEqual([137.38, -4.66])
    expect(anchorLngLat({ kind: 'cell', lon: 137.3, lat: -4.7 }, src, fb)).toEqual([137.3, -4.7])
    expect(anchorLngLat({ kind: 'edge', cause: 'slope', budget: 30, lon: 137.2, lat: -4.8 }, src, fb)).toEqual([137.2, -4.8])
    expect(anchorLngLat({ kind: 'leg', leg: 1 }, src, fb)).toEqual([137.405, -4.64])
    expect(anchorLngLat({ kind: 'edge', cause: 'slope', budget: 30 }, src, fb)).toBe(fb)
    expect(anchorLngLat({ kind: 'landmark', code: 'ZZ' }, src, null)).toBeNull()
  })
})

describe('card placement', () => {
  const gap = TOKENS.space[2]
  const covers = (p: { x: number; y: number }, at: { left: number; top: number }, c: { w: number; h: number }) => p.x >= at.left && p.x <= at.left + c.w && p.y >= at.top && p.y <= at.top + c.h

  it('beside the object at full width, else above / below, else beside and narrower', () => {
    expect(cardRoom({ x: 100, y: 300 }, { w: 1000, h: 600 }, gap)).toEqual({ maxW: 1000 - 100 - gap - 2, maxH: null })
    expect(cardRoom({ x: 900, y: 300 }, { w: 1000, h: 600 }, gap)).toEqual({ maxW: 900 - gap - 2, maxH: null })
    // a narrow map with the object in the middle: no side has the card width, so below it
    expect(cardRoom({ x: 200, y: 150 }, { w: 400, h: 600 }, gap)).toEqual({ maxW: 400, maxH: 600 - 150 - gap - 2 })
    // a low map: no room above or below, so beside it, narrower
    expect(cardRoom({ x: 350, y: 150 }, { w: 700, h: 300 }, gap)).toEqual({ maxW: 350 - gap - 2, maxH: null })
    expect(CARD_MIN_W).toBe(240)
  })

  it('never covers the selected point and stays inside the map (placeCard + cardRoom), over a grid of points and sizes', () => {
    for (const box of [
      { w: 1080, h: 780 },
      { w: 664, h: 640 },
      { w: 400, h: 500 },
      { w: 700, h: 300 },
      { w: 300, h: 260 },
    ])
      for (const want of [
        { w: 360, h: 220 },
        { w: 360, h: 640 },
        { w: 280, h: 900 },
      ])
        for (let x = 0; x <= box.w; x += box.w / 10)
          for (let y = 0; y <= box.h; y += box.h / 10) {
            const p = { x, y }
            const room = cardRoom(p, box, gap)
            const c = { w: Math.min(want.w, room.maxW, box.w), h: Math.min(want.h, room.maxH ?? Infinity, box.h) }
            const at = placeCard(p, c, box, gap)
            expect(covers(p, at, c), `point ${x},${y} card ${c.w}×${c.h} in ${box.w}×${box.h} at ${at.left},${at.top}`).toBe(false)
            expect(at.left).toBeGreaterThanOrEqual(0)
            expect(at.top).toBeGreaterThanOrEqual(0)
            expect(at.left + c.w).toBeLessThanOrEqual(box.w)
            expect(at.top + c.h).toBeLessThanOrEqual(box.h)
          }
  })
})

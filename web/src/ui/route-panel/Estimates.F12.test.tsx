// PORT F12 known answers for the storm switch in the Estimates card:
//  - the margin row names the core's binding term ("… · limited by O₂");
//  - storm on → a "Dose margin (storm replay)" row with the core's dose term, labelled "Estimate";
//    storm off → no dose row; nothing is recomputed in the card (numbers are the results' own).
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { all, installDom, type FakeDocument, type FakeNode } from '../testing/dom'
import { EstimatesBody, marginText } from './Estimates'
import { MOCK_ROUTE_RESULTS, type RouteResults } from './results'

let doc: FakeDocument
let root: FakeNode
const text = (n: FakeNode) => n.textContent.replace(/\s+/g, ' ').trim()
const rows = () => all(root, (n) => (n.getAttribute('class') ?? '').split(' ').includes('hl-rp__row')).map(text)

const READY: RouteResults = { ...MOCK_ROUTE_RESULTS, padId: 'official', status: 'ready', firstInfeasibleLeg: null, legs: MOCK_ROUTE_RESULTS.legs.map((l) => ({ ...l, feasible: true, reason: undefined })), marginMin: 43.6, binding: 'dose', doseMarginMin: 43.6 }

beforeEach(() => {
  ;({ document: doc } = installDom())
  root = doc.createElement('div')
  doc.body.appendChild(root)
})
afterEach(() => act(() => render(null, root as unknown as Element)))

const show = (r: RouteResults, storm: boolean) => act(() => render(<EstimatesBody results={r} stops={[]} padId="official" storm={storm} />, root as unknown as Element))

describe('F12: Estimates card shows the binding term and the storm dose term', () => {
  it('margin row names the binding term', () => {
    expect(marginText({ ...READY, marginMin: 54, binding: 'O2' })).toBe('54.0 min · limited by O₂')
    expect(marginText({ ...READY, marginMin: null, binding: null })).not.toContain('limited')
    show({ ...READY, marginMin: 206, binding: 'O2', doseMarginMin: null }, false)
    expect(rows().find((r) => r.startsWith('Margin'))).toContain('206.0 min · limited by O₂')
    expect(rows().some((r) => r.startsWith('Dose margin'))).toBe(false)
    expect(all(root, (n) => n.hasAttribute('data-estimates'))[0].getAttribute('data-binding')).toBe('O2')
  })

  it('storm on: dose row with the core number and "Estimate"; binding becomes the dose term', () => {
    show(READY, true)
    expect(rows().find((r) => r.startsWith('Margin'))).toContain('43.6 min · limited by dose (storm replay)')
    const dose = rows().find((r) => r.startsWith('Dose margin (storm replay)'))
    expect(dose).toContain('43.6 min')
    expect(dose).toContain('Estimate')
  })

  it('storm on but another term binds: the dose row still shows the dose term', () => {
    show({ ...READY, marginMin: -63.1, binding: 'EVA duration', doseMarginMin: 17.9 }, true)
    expect(rows().find((r) => r.startsWith('Margin'))).toContain('limited by EVA duration')
    expect(rows().find((r) => r.startsWith('Dose margin'))).toContain('17.9 min')
  })
})

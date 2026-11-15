// PORT F5: "Load into replay" (enabled only for a ready, complete route), the drawer label
// "Replaying: your route (estimate)", the way back ("Replay the official plan"), Estimate labels.
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createPlanningStore, type PlanningStore } from '../../state/planning'
import { MOCK_ROUTE_RESULTS, publishRouteResults, resetRouteResults, type RouteResults } from '../../state/routeResults'
import { replayOfficialPlan, userReplay } from '../../state/userReplay'
import { missionClock } from '../../state/mission'
import { all, installDom, one, type FakeNode } from '../testing/dom'
import { LoadIntoReplay, ReplaySourceBar, UserReplayReadout } from './userReplay'

let root: FakeNode
let store: PlanningStore
const text = (n: FakeNode) => n.textContent.replace(/\s+/g, ' ').trim()
const btn = (name: string) => one(all(root, (n) => n.localName === 'button' && n.textContent.trim() === name), `button "${name}"`)
const fire = (n: FakeNode) => act(() => void n.dispatch('click', {}))

const READY: RouteResults = {
  ...MOCK_ROUTE_RESULTS,
  status: 'ready',
  legs: [
    MOCK_ROUTE_RESULTS.legs[0],
    MOCK_ROUTE_RESULTS.legs[1],
    { ...MOCK_ROUTE_RESULTS.legs[2], minutes: 20, o2L: 10, feasible: true, path: [[137.408, -4.765], [137.385, -4.78]] },
  ],
  marginMin: 12.5,
}

function App() {
  return (
    <div>
      <LoadIntoReplay store={store} />
      <span data-bar>
        <ReplaySourceBar />
      </span>
      <UserReplayReadout store={store} />
    </div>
  )
}

beforeEach(() => {
  const { document: doc } = installDom()
  root = doc.createElement('div')
  doc.body.appendChild(root)
  store = createPlanningStore()
  store.addStop({ lon: 137.396, lat: -4.772, id: 'w1', stopMin: 10 } as never)
  store.addStop({ lon: 137.408, lat: -4.765, id: 's3', stopMin: 5 } as never)
  resetRouteResults()
  replayOfficialPlan()
})
afterEach(() => {
  act(() => render(null, root as unknown as Element))
  replayOfficialPlan()
  resetRouteResults()
})

describe('Load into replay (PORT F5)', () => {
  it('disabled until the route is ready and complete; the default stays the official replay', () => {
    act(() => render(<App />, root as unknown as Element))
    expect(btn('Load into replay').hasAttribute('disabled')).toBe(true)
    act(() => publishRouteResults(MOCK_ROUTE_RESULTS)) // last leg infeasible
    expect(btn('Load into replay').hasAttribute('disabled')).toBe(true)
    expect(text(root)).not.toContain('Replaying: your route')
    expect(userReplay.peek()).toBeNull()
  })

  it('switches to the user route with labels, and back to the official plan', () => {
    act(() => render(<App />, root as unknown as Element))
    act(() => publishRouteResults(READY))
    const b = btn('Load into replay')
    expect(b.hasAttribute('disabled')).toBe(false)
    fire(b)
    expect(userReplay.peek()?.totalMin).toBeCloseTo(79.5)
    expect(text(root)).toContain('Replaying: your route (estimate)')
    const nums = all(root, (n) => n.hasAttribute('data-estimate'))
    expect(nums.length).toBe(3)
    for (const n of nums) expect(text(n)).toMatch(/^Estimate /)
    expect(text(root)).toContain('Margin 12.5 min')
    expect(text(root)).toContain('Official plan values are hidden')
    act(() => missionClock.seek(20))
    expect(text(root)).toContain('At W1')
    expect(text(root)).toContain('O₂ of finished legs 9.6 L')
    fire(all(root, (n) => n.localName === 'button' && n.textContent.trim() === 'Replay the official plan')[0])
    expect(userReplay.peek()).toBeNull()
    expect(text(root)).not.toContain('Replaying: your route')
    expect(missionClock.t).toBe(0)
  })
})

// L7b (D111 T9): the "Official plan" seam: parts register, one call returns every part and the
// mission plan to the official plan and clears the selection.
import { afterEach, describe, expect, it } from 'vitest'
import { mission } from './mission'
import { differsFromOfficial, missionDiffers, OFFICIAL_BUDGET_MIN, officialPart, registerOfficialPart, resetOfficialParts, returnToOfficial } from './official'
import { resetSelection, select, selection } from './selection'
import { signal } from './signal'

afterEach(() => {
  resetOfficialParts()
  resetSelection()
  mission.plan.pad.value = null
  mission.plan.hash.value = undefined
  mission.plan.resultBase.value = undefined
  mission.plan.budgetMin.value = OFFICIAL_BUDGET_MIN
})

describe('official plan seam', () => {
  it('nothing differs at start: returnToOfficial is a no-op that still clears the selection', () => {
    expect(differsFromOfficial.value).toBe(false)
    select({ kind: 'station', id: 'S1' })
    expect(returnToOfficial()).toBe(false)
    expect(selection.selected.value).toBeNull()
  })

  it('mission plan: a parking option, a live result or another budget differ; returnToOfficial resets them', () => {
    mission.plan.pad.value = 'rank3'
    expect(missionDiffers.value).toBe(true)
    expect(differsFromOfficial.value).toBe(true)
    mission.plan.pad.value = null
    mission.plan.hash.value = 'abc'
    mission.plan.resultBase.value = 'https://x/'
    expect(differsFromOfficial.value).toBe(true)
    mission.plan.budgetMin.value = OFFICIAL_BUDGET_MIN + 30
    expect(returnToOfficial()).toBe(true)
    expect(mission.plan.hash.value).toBeUndefined()
    expect(mission.plan.resultBase.value).toBeUndefined()
    expect(mission.plan.budgetMin.value).toBe(OFFICIAL_BUDGET_MIN)
    expect(differsFromOfficial.value).toBe(false)
  })

  it('registered parts: differs follows them; only differing parts are reset, in one batch', () => {
    const a = signal(false)
    const calls: string[] = []
    const offA = registerOfficialPart({ id: 'a', differs: a, reset: () => (calls.push('a'), (a.value = false)) })
    const b = officialPart('live-route', () => calls.push('b'))
    expect(differsFromOfficial.value).toBe(false)
    a.value = true
    expect(differsFromOfficial.value).toBe(true)
    let seen = 0
    const unsub = differsFromOfficial.subscribe(() => seen++)
    expect(returnToOfficial()).toBe(true)
    expect(calls).toEqual(['a'])
    expect(differsFromOfficial.value).toBe(false)
    expect(seen).toBe(1)
    unsub()
    b.set(true)
    expect(differsFromOfficial.value).toBe(true)
    b.dispose()
    expect(differsFromOfficial.value).toBe(false)
    offA()
  })

  it('the same id replaces a part', () => {
    const x = officialPart('p', () => {})
    x.set(true)
    officialPart('p', () => {})
    expect(differsFromOfficial.value).toBe(false)
  })
})

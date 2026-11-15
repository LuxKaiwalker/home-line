// L7b (D111 T9): the plan-edit store's part of the "Official plan" action: rover back on the
// official pad, the official plan committed through the store's undoable path, draft discarded.
/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { differsFromOfficial, OFFICIAL_BUDGET_MIN, resetOfficialParts, returnToOfficial } from '../state/official'
import { resetSelection, select, selection } from '../state/selection'
import type { DragFields } from './drag'
import { isOfficialPlan, officialPlan, registerEditOfficial } from './official'
import { buildCatalog } from './options'
import { createRoverDrag } from './rover'
import { createPlanEditStore } from './store'

const PUB = resolve(__dirname, '../../public/data')
const json = (p: string) => JSON.parse(readFileSync(resolve(PUB, p), 'utf8'))
const catalog = buildCatalog(json('scenarios/index.json'), json('scenarios/pads/index.json'), json('stations.json'))
const fields: DragFields = { sample: () => null, slope: () => 2.5, grid: null }

afterEach(() => {
  resetOfficialParts()
  resetSelection()
})

describe('plan-edit store part', () => {
  it('the official plan is the store default (official pad, default scenario, official budget, no dwell)', () => {
    const store = createPlanEditStore({ catalog })
    expect(officialPlan(catalog)).toEqual(store.committed.value.plan)
    expect(OFFICIAL_BUDGET_MIN).toBe(catalog.bandBudgetsMin[0])
    expect(isOfficialPlan(store.committed.value.plan, catalog)).toBe(true)
  })

  it('a kept rover move differs; returnToOfficial puts the rover back on the official pad as one undo step', () => {
    const store = createPlanEditStore({ catalog })
    const rd = createRoverDrag(store, fields)
    const off = registerEditOfficial(store, rd)
    expect(differsFromOfficial.value).toBe(false)
    rd.cycle(1)
    expect(rd.keep()).toBe(true)
    expect(store.committed.value.plan.pad).not.toBe(catalog.officialPadId)
    expect(differsFromOfficial.value).toBe(true)
    const moved = store.committed.value.plan
    select({ kind: 'pad', id: String(moved.pad) })
    expect(returnToOfficial()).toBe(true)
    expect(store.committed.value.plan).toEqual(officialPlan(catalog))
    expect(rd.committedPadId()).toBe(catalog.officialPadId)
    expect(rd.state.value).toBeNull()
    expect(store.draft.value).toBeNull()
    expect(selection.selected.value).toBeNull()
    expect(differsFromOfficial.value).toBe(false)
    // undoable: Ctrl+Z brings the moved plan back
    expect(store.undo()).toBe(true)
    expect(store.committed.value.plan).toEqual(moved)
    off()
  })

  it('an open draft (released, not kept) differs; going back discards it and adds no undo step', () => {
    const store = createPlanEditStore({ catalog })
    const rd = createRoverDrag(store, fields)
    registerEditOfficial(store, rd)
    rd.cycle(1)
    expect(store.draft.value?.phase).toBe('released')
    expect(differsFromOfficial.value).toBe(true)
    returnToOfficial()
    expect(store.draft.value).toBeNull()
    expect(rd.state.value).toBeNull()
    expect(store.past.value).toHaveLength(0)
    expect(differsFromOfficial.value).toBe(false)
  })

  it('a scenario or budget change differs too and goes back', () => {
    const store = createPlanEditStore({ catalog })
    registerEditOfficial(store)
    const other = catalog.scenarios.find((s) => s.id !== catalog.defaultScenario)!
    store.apply({ scenario: other.id, budgetMin: catalog.bandBudgetsMin[1] ?? OFFICIAL_BUDGET_MIN })
    expect(differsFromOfficial.value).toBe(true)
    returnToOfficial()
    expect(store.committed.value.plan).toEqual(officialPlan(catalog))
  })
})

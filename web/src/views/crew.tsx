// "/crew" Crew configuration (PLAN rail, user 2026-11-15): the crew, masses, physiology and O2 / EVA limits
// the Mission Planer plans with. Read-only: the walk-home maps are precomputed per scenario, so a custom
// crew cannot be computed live (crewConfig.ts builds the rows from config/crew.yaml; hover a row for its key).
import './crew.css'
import { DummyNote } from '../components/labels'
import { data } from '../data/loader'
import { Page, preactView, Show, useLoad } from './page'
import { crewGroups } from './crewConfig'
import type { View } from './types'

export const view: View = preactView(() => <CrewPage />)

function CrewPage() {
  const L = data()
  const st = useLoad(async () => {
    const idx = await L.scenarios()
    const s = idx.scenarios.find((x) => x.id === idx.default) ?? idx.scenarios[0]
    if (!s) throw new Error('scenarios/index.json lists no scenario')
    return { assigned: { id: s.id, suitKg: s.suit_kg, variant: s.variant }, n: idx.scenarios.length }
  })
  return (
    <Page title="Crew configuration" wide>
      <DummyNote />
      <Show l={st} what="Crew configuration">
        {({ assigned, n }) => (
          <>
            <p class="cr-lead">
              What the Mission Planer plans with · scenario <code>{assigned.id}</code>
            </p>
            <div class="cr-grid">
              {crewGroups(assigned).map((g) => (
                <section key={g.title} class="cr-card">
                  <h3>{g.title}</h3>
                  <dl class="cr-rows">
                    {g.rows.map((r) => (
                      <div key={r.label} class="cr-row" title={`Source: ${r.source}${r.assumed ? ' (assumed value)' : ''}`}>
                        <dt>
                          {r.label}
                          {r.note && <span class="cr-note">{r.note}</span>}
                        </dt>
                        <dd>
                          {r.value}
                          {r.assumed && (
                            <span class="cr-assumed" aria-label="assumed value">
                              *
                            </span>
                          )}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ))}
            </div>
            <p class="cr-foot">
              <span class="cr-assumed">*</span> assumed value. View only: custom crews can't be set live, because the walk-home maps are precomputed for {n} fixed scenarios and
              computing new ones on demand is beyond our backend hardware.
            </p>
          </>
        )}
      </Show>
    </Page>
  )
}

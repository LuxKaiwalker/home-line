// /trade — trade table (F11): walkback budget (rows) x suit mass (columns). Each cell shows the
// science value reachable, % of the assessed disc reachable and the partner-line area, read from
// trade_table.json. Bars are drawn relative to the largest value of the same metric in the table.
import { CONFIG } from '../config'
import { data } from '../data/loader'
import type { TradeCell, TradeTable } from '../data/types'
import { AssumedTag, DummyNote } from '../components/labels'
import { Num } from '../components/Num'
import { Page, preactView, Show, useLoad } from './page'

const METRICS: { key: keyof TradeCell; label: string; units: string | null }[] = [
  { key: 'science_value', label: 'Science value reachable', units: null },
  { key: 'reachable_pct', label: 'Assessed disc reachable', units: '%' },
  { key: 'partner_area_km2', label: 'Partner-line area', units: 'km2' },
]

function maxOf(t: TradeTable, k: keyof TradeCell): number {
  let m = 0
  for (const row of t.cells) for (const c of row) if (typeof c[k] === 'number' && (c[k] as number) > m) m = c[k] as number
  return m
}

function TradeView() {
  const l = useLoad(() => data().trade())
  return (
    <Page title="Trade: walkback × suit mass">
      <DummyNote />
      <p class="lead">
        How the walkback budget and the suit mass change the science a crew can reach and still get home from.
      </p>
      <Show l={l} what="Trade table">
        {(t) => (
          <div class="table-scroll">
            <table class="trade">
              <thead>
                <tr>
                  <th>Walkback</th>
                  {t.cols.map((kg) => (
                    <th>
                      {kg} kg suit
                      {kg === Math.min(...CONFIG.suitMassesKg) && kg !== CONFIG.defaultSuitKg ? (
                        <>
                          {' '}
                          <AssumedTag note="Our sensitivity value, not a NASA suit mass (SPEC F6)" />
                        </>
                      ) : null}
                      {kg === CONFIG.defaultSuitKg ? <span class="muted"> (default)</span> : null}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {t.rows.map((budget, i) => (
                  <tr>
                    <th>{budget} min</th>
                    {t.cols.map((kg, j) => {
                      const c = t.cells[i]?.[j]
                      return (
                        <td>
                          {c ? (
                            METRICS.map((m) => {
                              const v = c[m.key]
                              const max = maxOf(t, m.key)
                              return (
                                <div class="trade-metric">
                                  <span class="trade-label">{m.label}</span>
                                  <Num v={v} units={m.units} file="trade_table.json" k={`trade.${budget}.${kg}.${m.key}`} />
                                  <span class="bar">
                                    <span style={{ width: typeof v === 'number' && max > 0 ? `${(100 * v) / max}%` : '0' }} />
                                  </span>
                                </div>
                              )
                            })
                          ) : (
                            <span class="num-unknown">no cell</span>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Show>
      <p class="caption">
        Science value: Σ station value within the conservative homeline. Partner-line area: design question; every haul parameter is
        an assumed band.
      </p>
    </Page>
  )
}

export const view = preactView(() => <TradeView />)

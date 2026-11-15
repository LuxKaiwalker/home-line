// The station detail pages as sub-entries of "Science stations" in the left rail (SCIENCE mode,
// user 2026-11-15): one link per station of stations.json, the open one marked as the current page.
import { useEffect, useState } from 'preact/hooks'
import { data } from '../../data/loader'
import { href, type Route } from '../../router'
import { cx } from '../components'

type Row = { id: string; name: string }
let cache: Promise<Row[]> | undefined

export function StationLinks({ route }: { route: Route }) {
  const [rows, setRows] = useState<Row[] | null>(null)
  useEffect(() => {
    let alive = true
    cache ??= data()
      .stations()
      .then((st) => st.map((s) => ({ id: s.id, name: s.name })))
    cache.then(
      (r) => alive && setRows(r),
      () => {
        cache = undefined // the overview page shows the data problem; try again next time
      },
    )
    return () => {
      alive = false
    }
  }, [])
  if (!rows?.length) return null
  return (
    <ul class="hl-rail__subviews" role="list">
      {rows.map((s) => {
        const on = route.name === 'station' && route.id === s.id
        return (
          <li key={s.id}>
            <a class={cx('hl-rail__subview', on && 'is-active')} href={href({ name: 'station', id: s.id })} aria-current={on ? 'page' : undefined} title={`${s.id} ${s.name}`}>
              <b>{s.id}</b>
              <span>{s.name}</span>
            </a>
          </li>
        )
      })}
    </ul>
  )
}

// L-05 (team lead D114; WP12): the route section's one line while the live planner is unreachable.
// Exported for design's L3 (the route panel moves into a right drawer behind a map-edge "Edit route"
// button; this note then takes the button's place). It renders only while live planning is
// unreachable (`note` non-null) and carries no control (kit rule 4: live controls hide behind the
// offline banner). The live side (live/route/mount.tsx) drives `note` from the same health state the
// panel uses (index.ts onLiveState + bannerFor): offline -> ROUTE_TEXT.offlineNote; checking or
// warming -> the banner's text; ready -> null (the panel is back, without a reload).
import { useSignalValue, type ReadSignal } from '../../state/signal'
import { ROUTE_TEXT } from './text'
import './route.css'

/** The note text for a live state: null while live planning is ready. Pure (no import from src/live). */
export function offlineNoteText(s: { kind: 'checking' | 'offline' | 'warming' | 'ready' }, bannerText: string | null = null): string | null {
  if (s.kind === 'ready') return null
  return s.kind === 'offline' ? ROUTE_TEXT.offlineNote : (bannerText ?? ROUTE_TEXT.checkingLive)
}

export function RouteOfflineNote({ note }: { note: ReadSignal<string | null> }) {
  const text = useSignalValue(note)
  if (text === null) return null
  return (
    <p class="hl-route-offline" role="status" data-route-offline>
      {text}
    </p>
  )
}

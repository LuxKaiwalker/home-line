// WP13 (L6 W-6): the trust badge of a planning answer. "Estimate": the Live pad card's instant preview
// and the ghost route (fast screens, not the plan); "Computed live": a finished job's result. The same
// component in the route panel and the pad-tool card, so the two never read alike.
// Local minimal equivalent of design's L8r <Badge kind="estimate"|"computed"> (web/src/ui/components,
// in Banner.tsx, not on design yet): same props and data-badge; switch the import when it lands.
import { cx } from '../../ui/components/Icon'
import { ChipMark } from '../../ui/components/TrustChip'
import { t } from '../../ui/copy'
import { BADGE_TEXT } from './text'
import './badge.css'

export type BadgeKind = 'estimate' | 'computed'

export interface BadgeProps {
  kind: BadgeKind
}

export function Badge({ kind }: BadgeProps) {
  const b = BADGE_TEXT[kind]
  // the copy deck's explanations where it has them (tags.estimate, chips.live)
  const title = kind === 'estimate' ? t('tags.estimate.explanation') : t('chips.live.explanation')
  return (
    <span class={cx('hl-route-badge', `hl-route-badge--${kind}`)} data-badge={kind} title={title}>
      {kind === 'computed' ? <ChipMark kind="live" /> : null}
      {b.label}
    </span>
  )
}

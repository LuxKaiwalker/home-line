// Banner (info / caution / offline / limit alarm), badge (codes such as S7, PAD) and tag (the
// copy.json tags: assumed, precomputed, live, hypothetical timing, …). DESIGN §3.7, §3.1 colours.
import type { ComponentChildren } from 'preact'
import { t } from '../copy'
import { IconButton } from './Button'
import { cx, Icon, type IconName } from './Icon'
import { ChipMark } from './TrustChip'

export type BannerKind = 'info' | 'caution' | 'offline' | 'limit'

const BANNER_ICON: Record<BannerKind, IconName> = { info: 'info', caution: 'triangle-alert', offline: 'wifi-off', limit: 'circle-alert' }

export interface BannerProps {
  kind: BannerKind
  title: string
  children?: ComponentChildren
  onDismiss?: () => void
}

/** `limit` is the alarm banner (role alert, announced at once); the others are polite status. */
export function Banner({ kind, title, children, onDismiss }: BannerProps) {
  return (
    <div class={cx('hl-banner', `hl-banner--${kind}`)} role={kind === 'limit' ? 'alert' : 'status'}>
      <Icon name={BANNER_ICON[kind]} class="hl-banner__icon" />
      <div class="hl-banner__text">
        <div class="hl-banner__title">{title}</div>
        {children && <div class="hl-banner__body">{children}</div>}
      </div>
      {onDismiss && <IconButton icon="x" label={t('buttons.close')} onClick={onDismiss} class="hl-banner__close" />}
    </div>
  )
}

export type BadgeKind = 'estimate' | 'computed'

export interface BadgeProps {
  /**
   * Without a kind: a short code (children: station, pad, landmark) in mono on a pill.
   * `estimate`: an instant estimate (dashed, neutral); `computed`: a computed-live result (live purple, ◆).
   * Text and tooltip from copy.json hints.badges.{kind} (D117, L6 L-10).
   */
  kind?: BadgeKind
  children?: ComponentChildren
}

export function Badge({ kind, children }: BadgeProps) {
  if (!kind) return <span class="hl-badge">{children}</span>
  return (
    <span class={cx('hl-badge', `hl-badge--${kind}`)} data-badge={kind} title={t(`hints.badges.${kind}.explanation`)}>
      {kind === 'computed' && <ChipMark kind="live" />}
      {t(`hints.badges.${kind}.label`)}
    </span>
  )
}

export type TagKind = 'assumed' | 'precomputed' | 'live' | 'hypotheticalTiming' | 'preliminary' | 'estimate' | 'dummy'

/** A copy.json tag; the explanation is the hover title. `live` uses the live colour (§3.1). */
export function Tag({ kind }: { kind: TagKind }) {
  return (
    <span class={cx('hl-tag', `hl-tag--${kind}`)} title={t(`tags.${kind}.explanation`)}>
      {t(`tags.${kind}.label`)}
    </span>
  )
}

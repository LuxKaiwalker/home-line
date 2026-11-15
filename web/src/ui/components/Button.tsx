// Buttons (DESIGN §3.7): primary, secondary, ghost, danger (+ live for "computed live" controls,
// §3.1 purple); states hover, press, focus-visible, disabled, busy.
import type { ButtonHTMLAttributes, ComponentChildren } from 'preact'
import { DisabledReason, reasonTitle } from './DisabledReason'
import { cx, Icon, type ForcedState, type IconName } from './Icon'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'live'

type Native = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'icon' | 'label' | 'size'>

export interface ButtonProps extends Native {
  variant?: ButtonVariant
  icon?: IconName
  /** Work in progress: spinner, aria-busy, clicks ignored, still focusable. */
  busy?: boolean
  disabled?: boolean
  /** Why it is disabled (copy.json, e.g. hints.disabled.*): tooltip on a wrapper and hidden text (D117). */
  reason?: string | null
  force?: ForcedState
  children?: ComponentChildren
}

export function Button({ variant = 'secondary', icon, busy, disabled, reason, force, children, onClick, class: cls, title, ...rest }: ButtonProps) {
  return (
    <DisabledReason reason={reason} disabled={!!disabled}>
      <button
        type="button"
        {...rest}
        title={reasonTitle(disabled, reason, title as string | undefined)}
        class={cx('hl-btn', `hl-btn--${variant}`, cls as string)}
        disabled={disabled}
        aria-busy={busy ? 'true' : undefined}
        aria-disabled={busy ? 'true' : undefined}
        data-force={force}
        onClick={(e) => {
          if (busy || disabled) return
          onClick?.(e)
        }}
      >
        {busy ? <Icon name="loader-circle" class="hl-spin" /> : icon && <Icon name={icon} />}
        {children}
      </button>
    </DisabledReason>
  )
}

export interface IconButtonProps extends Native {
  icon: IconName
  /** Accessible name (from copy.json); also the tooltip text when wrapped in <Tooltip>. */
  label: string
  pressed?: boolean
  disabled?: boolean
  /** Why it is disabled (copy.json): tooltip on a wrapper and hidden text (D117). */
  reason?: string | null
  force?: ForcedState
}

export function IconButton({ icon, label, pressed, disabled, reason, force, class: cls, title, ...rest }: IconButtonProps) {
  return (
    <DisabledReason reason={reason} disabled={!!disabled}>
      <button
        type="button"
        {...rest}
        title={reasonTitle(disabled, reason, title as string | undefined)}
        class={cx('hl-iconbtn', cls as string)}
        aria-label={label}
        aria-pressed={pressed === undefined ? undefined : pressed ? 'true' : 'false'}
        disabled={disabled}
        data-force={force}
      >
        <Icon name={icon} />
      </button>
    </DisabledReason>
  )
}

// Why a control is disabled (D117, L6 L-09): no control without an effect or a stated reason.
// A disabled button gets no pointer events (and no focus) in some browsers, so its title alone never
// shows: the reason sits on a wrapper span (hover tooltip) and in a visually hidden copy next to the
// control (screen readers in browse mode). Text comes from copy.json (hints.disabled.* or the caller's key).
import type { ComponentChildren } from 'preact'

/** A gate such as state/activity.ts canStart(): ok, or not ok with the reason to show. */
export interface Check {
  ok: boolean
  reason?: string | null
}

/** `{ disabled, reason }` for a control from a check; spreads onto Button / IconButton. */
export function fromCheck(check: Check): { disabled: boolean; reason: string | null } {
  return check.ok ? { disabled: false, reason: null } : { disabled: true, reason: check.reason ?? null }
}

/** The native `title` for a control: the reason while disabled, else the normal title (if any). */
export function reasonTitle(disabled: boolean | undefined, reason: string | null | undefined, title?: string): string | undefined {
  return disabled && reason ? reason : title
}

export interface DisabledReasonProps {
  /** Why the control is (or would be) disabled; null/undefined/empty renders the children alone. */
  reason?: string | null
  /** Whether the control is disabled now (default true). Pass the live state rather than toggling
   * `reason`: the wrapper then stays mounted, so the control is not remounted (focus, refs, tests). */
  disabled?: boolean
  children: ComponentChildren
}

/** Wraps a control so the reason it is disabled shows on hover and reaches assistive tech. */
export function DisabledReason({ reason, disabled = true, children }: DisabledReasonProps) {
  if (!reason) return <>{children}</>
  return (
    <span class="hl-why" title={disabled ? reason : undefined} data-reason={disabled ? reason : undefined}>
      {children}
      {disabled && <span class="hl-why__sr">{reason}</span>}
    </span>
  )
}

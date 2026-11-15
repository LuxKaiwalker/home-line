// Test helpers (WP12): a window double that runs capture listeners before the others (as a browser
// window does for an event aimed at an element inside the page) and key events for Ctrl/Cmd-Z.
// Imported only by tests.
type Fn = (e: Event) => void

export class FakeWindow {
  private cap = new Map<string, Fn[]>()
  private bub = new Map<string, Fn[]>()
  addEventListener(type: string, fn: Fn, opts?: boolean | AddEventListenerOptions): void {
    const m = (typeof opts === 'boolean' ? opts : !!opts?.capture) ? this.cap : this.bub
    m.set(type, [...(m.get(type) ?? []), fn])
  }
  removeEventListener(type: string, fn: Fn, opts?: boolean | EventListenerOptions): void {
    const m = (typeof opts === 'boolean' ? opts : !!opts?.capture) ? this.cap : this.bub
    m.set(
      type,
      (m.get(type) ?? []).filter((f) => f !== fn),
    )
  }
  dispatchEvent(e: Event): boolean {
    let stop = false
    const orig = e.stopImmediatePropagation.bind(e)
    e.stopImmediatePropagation = () => {
      stop = true
      orig()
    }
    for (const fn of [...(this.cap.get(e.type) ?? []), ...(this.bub.get(e.type) ?? [])]) {
      if (stop) break
      fn(e)
    }
    return !e.defaultPrevented
  }
  listeners(type: string): number {
    return (this.cap.get(type)?.length ?? 0) + (this.bub.get(type)?.length ?? 0)
  }
}

/** A keydown as the browser sends it (target = the focused element, e.g. outside the panel). */
export function keydown(init: { key: string; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean; target?: unknown }): KeyboardEvent {
  const e = new Event('keydown', { cancelable: true }) as KeyboardEvent
  for (const [k, v] of Object.entries({ ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, isComposing: false, target: null, ...init })) Object.defineProperty(e, k, { value: v })
  return e
}

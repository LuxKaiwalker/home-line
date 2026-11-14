// 2D fallback (SPEC F20 Durability): without WebGL2, or when the frame rate stays low, the 3D
// view gives way to the 2D HUD. Kept free of Three.js so the check runs before the 3D bundle loads.

export type FallbackReason = 'no-webgl2' | 'low-fps' | 'load-error'

export function hasWebGL2(createCanvas: () => HTMLCanvasElement = () => document.createElement('canvas')): boolean {
  try {
    const gl = createCanvas().getContext('webgl2')
    if (!gl) return false
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return true
  } catch {
    return false
  }
}

export function fallbackMessage(reason: FallbackReason, detail?: string): string {
  switch (reason) {
    case 'no-webgl2':
      return 'This browser has no WebGL2, so the 3D view cannot run.'
    case 'low-fps':
      return `The 3D view ran too slowly on this device${detail ? ` (${detail})` : ''}.`
    case 'load-error':
      return `The 3D terrain could not be loaded${detail ? `: ${detail}` : ''}.`
  }
}

/** Replace the container content with the fallback panel linking to the 2D HUD. */
export function renderFallback(
  container: HTMLElement,
  reason: FallbackReason,
  opts: { hud2dHref: string; simulatedLabel: string; detail?: string },
): void {
  container.replaceChildren()
  const box = document.createElement('div')
  box.className = 'fp3d-fallback'
  box.dataset.reason = reason
  box.style.cssText =
    'display:flex;flex-direction:column;gap:.6em;align-items:flex-start;padding:1.5em;max-width:40em;font:14px/1.4 system-ui,sans-serif'
  const h = document.createElement('h2')
  h.textContent = '3D first-person view unavailable'
  const p = document.createElement('p')
  p.textContent = `${fallbackMessage(reason, opts.detail)} The same replay runs on the 2D HUD.`
  const a = document.createElement('a')
  a.href = opts.hud2dHref
  a.textContent = 'Open the 2D HUD'
  const s = document.createElement('p')
  s.textContent = opts.simulatedLabel
  s.style.opacity = '0.7'
  box.append(h, p, a, s)
  container.append(box)
}

// J1c (D135): copy-deck text with elements in its {placeholders} (a <code> file name, a link), for the
// Mission Planer's captions. Strings and numbers fill in as with t(); any other value is placed as a node.
import type { ComponentChild } from 'preact'
import { t, type CopyKey, type CopyVars } from '../ui/copy'

const MARK = '\u0000'

export function tx(key: CopyKey, vars: Record<string, ComponentChild> = {}): ComponentChild[] {
  const nodes: ComponentChild[] = []
  const flat: CopyVars = {}
  for (const [k, v] of Object.entries(vars)) {
    if (typeof v === 'string' || typeof v === 'number') flat[k] = v
    else {
      flat[k] = `${MARK}${nodes.length}${MARK}`
      nodes.push(v)
    }
  }
  return t(key, flat)
    .split(new RegExp(`${MARK}(\\d+)${MARK}`))
    .map((part, i) => (i % 2 ? nodes[Number(part)] : part))
    .filter((p) => p !== '')
}

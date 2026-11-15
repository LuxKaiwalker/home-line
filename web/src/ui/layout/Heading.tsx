// A heading of a chosen level (containers sit at different depths of the page outline).
import type { ComponentChildren } from 'preact'

export type HeadingLevel = 2 | 3 | 4 | 5 | 6

export function Heading({ level, id, class: cls, children }: { level: HeadingLevel; id?: string; class?: string; children: ComponentChildren }) {
  const H = `h${level}` as 'h2'
  return (
    <H id={id} class={cls}>
      {children}
    </H>
  )
}

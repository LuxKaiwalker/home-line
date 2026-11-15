// PORT L1a: slope layer state shared by the layer-popover control and the map layer. In memory only.
import { batch, signal } from '../../../state/signal'
import { clampSlopeOpacity, SLOPE_DEFAULT_ON, SLOPE_DEFAULT_OPACITY } from './classes'

export type SlopeStatus = 'idle' | 'loading' | 'ready' | 'error'

export const slopeOn = signal<boolean>(SLOPE_DEFAULT_ON)
export const slopeOpacity = signal<number>(SLOPE_DEFAULT_OPACITY)
/** idle until the first "on" (nothing is fetched in the default view) */
export const slopeStatus = signal<SlopeStatus>('idle')
export const slopeError = signal<string | null>(null)
/** data file the raster came from (fields/index.json slope entry), once loaded */
export const slopeFile = signal<string | null>(null)

export const setSlopeOn = (on: boolean): void => void (slopeOn.value = on)
export const setSlopeOpacity = (v: number): void => void (slopeOpacity.value = clampSlopeOpacity(v))

/** Back to the default view (tests). */
export function resetSlope(): void {
  batch(() => {
    slopeOn.value = SLOPE_DEFAULT_ON
    slopeOpacity.value = SLOPE_DEFAULT_OPACITY
    slopeStatus.value = 'idle'
    slopeError.value = null
    slopeFile.value = null
  })
}

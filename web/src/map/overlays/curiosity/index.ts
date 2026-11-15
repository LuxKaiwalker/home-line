// L1b: Curiosity route and photos on the Plan map (port of the Mission Planer's layer). Importing this
// module registers the overlay + its layer-popover row (I1: one side-effect import in views/console.tsx).
import { install } from './install'

install()

export { install } from './install'
export { CURIOSITY_CARD, CURIOSITY_ID, curiosityOn, curiosityStatus, setCuriosityEnabled, setCuriosityOn } from './store'

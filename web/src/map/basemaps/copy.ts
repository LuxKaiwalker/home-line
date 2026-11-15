// L1c strings (route.basemaps.* after I4's merge; until then read from copy.L1c.json).
import { copyFrom } from '../../ui/copy'
import own from './copy.L1c.json'

export const bt = copyFrom(own)

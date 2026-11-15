// PORT U1: the Route panel shell's strings (copy.U1.json, keys as they will sit under route.*).
// I4 merges them into ui/copy.json and swaps tr('panel.…') for t('route.panel.…').
import { copyFrom } from '../copy'
import own from './copy.U1.json'

export const tr = copyFrom(own)

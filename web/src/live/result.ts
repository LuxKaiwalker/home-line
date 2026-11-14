// A live result is a data tree in the static contracts (kit rule 7: one rendering path). Load it
// through the existing contract-checking loader with the result's base URL; no second renderer.
import { browserFetcher, createLoader, type Loader } from '../data/loader'

/** resultBase: ApiClient.resultBase(job) or JobOutcome.resultBase. */
export function liveLoader(resultBase: string): Loader {
  return createLoader(browserFetcher('real', resultBase), 'real')
}

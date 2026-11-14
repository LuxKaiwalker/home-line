// Data source switch (docs/dummy.md): VITE_DATA=dummy reads data-dummy/, otherwise data/.
export type DataMode = 'dummy' | 'real'

export const DATA_MODE: DataMode = import.meta.env.VITE_DATA === 'dummy' ? 'dummy' : 'real'

export function dataDir(mode: DataMode = DATA_MODE): string {
  return mode === 'dummy' ? 'data-dummy' : 'data'
}

/** URL of a data file, relative to the page (base './' + hash routing keeps this stable). */
export function dataUrl(path: string, mode: DataMode = DATA_MODE): string {
  return `${import.meta.env.BASE_URL}${dataDir(mode)}/${path.replace(/^\/+/, '')}`
}

export const IS_DEV = import.meta.env.DEV

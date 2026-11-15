// P1 (plan port): the pad environment loaders. Pure I/O + parsing; the cache, dedupe, abort, prefetch
// and load states live in service.ts. Field decoding is hud/fields' (decodeRGBA, fieldGrid, FieldGrid)
// and hud/wayhome's (PointerField), the same keys as mission/pads.ts fieldKeys and
// edit/route/browser/data.ts (copied, not imported: §7b isolation, nothing here imports edit/route/**).
// JSON goes through data/loader createLoader, so every file is checked against its contract exactly as
// the console's own loads are. Each env gets its own loader: its JSON cache dies with the env (LRU).
import { CONFIG } from '../config'
import { createLoader, DataError, type Loader, type TextFetcher } from '../data/loader'
import { padFiles, parsePadsIndex, parsePadSummary, PADS_INDEX, type PadsIndexView } from '../data/pads'
import type { BandsFC, EdgesFC, PartnerFC, RouteFC, ScenarioEntry, TimelineEvent } from '../data/types'
import { DATA_MODE, dataUrl, type DataMode } from '../env'
import { decodeRGBA, FieldGrid, fieldGrid } from '../hud/fields'
import type { FieldsIndex } from '../hud/types'
import { PointerField } from '../hud/wayhome'
import { copyFrom, t } from '../ui/copy'
import copyP1 from './copy.P1.json'
import { OFFICIAL_PAD_ID, type PadEnv, type PadEnvFiles, type PadId, type PadInfo, type PlanProducts, type RoutingFields } from './types'

/** route.pads.* strings of this package (I4 merges them into copy.json). */
export const padCopy = copyFrom(copyP1)

export type Rgba = { rgba: ArrayLike<number>; width: number; height: number }

/** What the loaders touch outside JS: tests replace fetch (and the PNG decoder, node has no canvas). */
export interface PadIo {
  fetch: typeof fetch
  /** PNG blob -> RGBA bytes, no premultiplication, no colour management (hud/fields loadFieldRGBA) */
  decodePng: (blob: Blob) => Promise<Rgba>
  /** data path -> URL (env.ts dataUrl) */
  url: (path: string) => string
  mode: DataMode
}

/** hud/fields loadFieldRGBA, from a blob already fetched (so the fetch can carry an AbortSignal). */
export async function decodePngBlob(blob: Blob): Promise<Rgba> {
  const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
  const { width, height } = bmp
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : Object.assign(document.createElement('canvas'), { width, height })
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
  if (!ctx) throw new Error('Canvas 2D unavailable')
  ctx.drawImage(bmp, 0, 0)
  bmp.close()
  return { rgba: ctx.getImageData(0, 0, width, height, { colorSpace: 'srgb' }).data, width, height }
}

export const defaultIo = (): PadIo => ({
  fetch: (...a) => globalThis.fetch(...a),
  decodePng: decodePngBlob,
  url: (p) => dataUrl(p),
  mode: DATA_MODE,
})

/** Request options: abort, and low fetch priority for idle prefetch. */
export interface Req {
  signal?: AbortSignal
  low?: boolean
}

const init = (r: Req): RequestInit => ({ signal: r.signal, ...(r.low ? { priority: 'low' } : {}) }) as RequestInit

export const abortError = (): Error =>
  typeof DOMException === 'function' ? (new DOMException('Aborted', 'AbortError') as Error) : Object.assign(new Error('Aborted'), { name: 'AbortError' })
export const isAbortError = (e: unknown): boolean => !!e && typeof e === 'object' && (e as { name?: unknown }).name === 'AbortError'
function check(r: Req): void {
  if (r.signal?.aborted) throw abortError()
}

/** data/loader browserFetcher with a signal: null = absent (404, or the dev server's index.html). */
export function textFetcher(io: PadIo, r: Req = {}): TextFetcher {
  return async (path) => {
    check(r)
    const res = await io.fetch(io.url(path), init(r))
    if (res.status === 404) return null
    if (!res.ok) throw new DataError(path, 'missing', `HTTP ${res.status}`)
    const text = await res.text()
    check(r)
    return /^\s*<!doctype html/i.test(text) ? null : text
  }
}

export const padLoader = (io: PadIo, r: Req = {}): Loader => createLoader(textFetcher(io, r), io.mode)

async function fieldRgba(io: PadIo, fi: FieldsIndex, key: string, r: Req): Promise<{ meta: FieldsIndex['fields'][string]; px: Rgba }> {
  const meta = fi.fields[key]
  if (!meta) throw new Error(`fields/index.json has no field ${key}`)
  check(r)
  const res = await io.fetch(io.url(meta.file), init(r))
  if (!res.ok) throw new DataError(meta.file, 'missing', `HTTP ${res.status}`)
  const blob = await res.blob()
  check(r)
  const px = await io.decodePng(blob)
  check(r)
  return { meta, px }
}

/** hud/fields loadField with abort + priority. */
export async function loadFieldGrid(io: PadIo, fi: FieldsIndex, key: string, r: Req = {}): Promise<FieldGrid> {
  const { meta, px } = await fieldRgba(io, fi, key, r)
  return new FieldGrid(fieldGrid(fi, key), decodeRGBA(px.rgba, px.width, px.height, meta.scale), meta.units)
}

/** hud/wayhome loadPointer with abort + priority. */
export async function loadPointerField(io: PadIo, fi: FieldsIndex, key: string, r: Req = {}): Promise<PointerField> {
  const { meta, px } = await fieldRgba(io, fi, key, r)
  if (!meta.stencil) throw new Error(`${key} has no stencil in fields/index.json`)
  return new PointerField(new FieldGrid(fieldGrid(fi, key), decodeRGBA(px.rgba, px.width, px.height, meta.scale), meta.units), meta.stencil)
}

// ---- the index ------------------------------------------------------------------------------------

/** fields/index.json keys of a pad's fields (mission/pads.ts fieldKeys): official = the scenario's own. */
export function padFieldKeys(official: boolean, sourceId: string, scenario: string): { tHome: string; o2Home: string; pointer: string } {
  const pre = official ? `${scenario}/` : `pads/${sourceId}/${scenario}/`
  return { tHome: `${pre}t_home`, o2Home: `${pre}o2_home`, pointer: `${pre}pointer` }
}

/** Picker label: "P3" for rank3 (mission/pads.ts padLabel), the official pad and pad_default by name. */
export function padLabelOf(id: string, official: boolean, rank: number | null): string {
  if (official) return t('route.pads.official')
  const m = /^rank(\d+)$/.exec(id)
  if (m) return padCopy('pickerLabel', { rank: m[1] })
  if (id === 'pad_default') return padCopy('defaultPad')
  return rank !== null ? padCopy('pickerLabel', { rank }) : id
}

export interface PadIndexData {
  pads: PadInfo[]
  /** the default scenario (scenarios/index.json default: nom_104) */
  scenario: string
  fields: FieldsIndex
}

/** The official pad's files: the default scenario's own products (scenarios/index.json). */
function officialFiles(nominal: ScenarioEntry, fi: FieldsIndex): PadEnvFiles {
  const keys = padFieldKeys(true, 'rank1', nominal.id)
  return {
    fields: fi.fields[keys.tHome] ? keys : null,
    summary: null,
    bands: nominal.files.bands,
    edges: nominal.files.edges,
    partner: nominal.files.partner ?? null,
    route: `route_${nominal.id}.geojson`,
    timeline: `timeline_${nominal.id}.json`,
  }
}

/**
 * The pads: official first (id 'official', source row rank1 or pad.json), then the index rows by rank.
 * Without scenarios/pads/index.json the list is the official pad alone.
 */
export async function buildPadIndex(L: Loader): Promise<PadIndexData> {
  const [scen, fiRaw, padsRaw, padFile] = await Promise.all([
    L.scenarios(),
    L.fieldsIndex(),
    L.optional(() => L.json<unknown>(PADS_INDEX)).catch(() => null),
    L.optional(() => L.pad()).catch(() => null),
  ])
  const fi = fiRaw as unknown as FieldsIndex
  const scenario = scen.default ?? CONFIG.defaultScenario
  const nominal = scen.scenarios.find((s) => s.id === scenario)
  if (!nominal) throw new Error(`scenarios/index.json has no default scenario ${scenario}`)
  let index: PadsIndexView | null = null
  try {
    index = padsRaw ? parsePadsIndex(padsRaw) : null
  } catch {
    index = null // a broken index hides the picker pads; the official pad stays (as the console does)
  }
  const off = index?.official
  const p = padFile?.pad as { lon: number; lat: number; elev_m?: number; id?: string } | undefined
  const lon = off?.lon ?? p?.lon
  const lat = off?.lat ?? p?.lat
  if (typeof lon !== 'number' || typeof lat !== 'number') throw new Error('no position for the official pad (scenarios/pads/index.json, pad.json)')
  const official: PadInfo = {
    id: OFFICIAL_PAD_ID,
    sourceId: off?.id ?? p?.id ?? 'rank1',
    label: padLabelOf(OFFICIAL_PAD_ID, true, 1),
    lon,
    lat,
    elevM: off?.elevM ?? (typeof p?.elev_m === 'number' ? p.elev_m : null),
    rank: off?.rank ?? 1,
    official: true,
    hasRoutingFields: false,
    files: officialFiles(nominal, fi),
  }
  official.hasRoutingFields = !!official.files.fields
  const others: PadInfo[] = []
  for (const o of index?.options ?? []) {
    if (o.official || o.lon === null || o.lat === null) continue
    const f = padFiles(o.id, nominal)
    const keys = padFieldKeys(false, o.id, scenario)
    const has = !!fi.fields[keys.tHome]
    others.push({
      id: o.id,
      sourceId: o.id,
      label: padLabelOf(o.id, false, o.rank),
      lon: o.lon,
      lat: o.lat,
      elevM: o.elevM,
      rank: o.rank,
      official: false,
      hasRoutingFields: has,
      files: { fields: has ? keys : null, summary: f.summary, bands: f.bands, edges: f.edges, partner: f.partner, route: f.route, timeline: f.timeline },
    })
  }
  others.sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity))
  return { pads: [official, ...others], scenario, fields: fi }
}

// ---- one pad --------------------------------------------------------------------------------------

/** A pad cannot give what was asked (pad_default: no routing fields; an unknown id). */
export class PadError extends Error {
  readonly padId: PadId
  readonly kind: 'unknown' | 'no-routing-fields'
  constructor(padId: PadId, kind: 'unknown' | 'no-routing-fields', message: string) {
    super(message)
    this.name = 'PadError'
    this.padId = padId
    this.kind = kind
  }
}

/** The pad's precomputed plan; bands and edges required, the rest null when absent. */
export async function loadPlanProducts(L: Loader, files: PadEnvFiles): Promise<PlanProducts> {
  const opt = <T>(path: string | null) => (path ? L.optional(() => L.json<T>(path)) : Promise.resolve(null))
  const [bands, edges, partner, route, timeline] = await Promise.all([
    L.json<BandsFC>(files.bands),
    L.json<EdgesFC>(files.edges),
    opt<PartnerFC>(files.partner),
    opt<RouteFC>(files.route),
    opt<TimelineEvent[]>(files.timeline),
  ])
  return { bands, edges, partner, route, timeline }
}

/** Lazy plan products: the first call fetches (no abort: the env outlives the load that made it); a failure can be retried. */
export function lazyProducts(io: PadIo, files: PadEnvFiles): () => Promise<PlanProducts> {
  let p: Promise<PlanProducts> | null = null
  return () => {
    if (!p) {
      const q = loadPlanProducts(padLoader(io), files)
      q.catch(() => {
        if (p === q) p = null
      })
      p = q
    }
    return p
  }
}

/** Routing fields first (T_home, O2_home, pointer: ~5 MB) with the small summary; plan products lazily. */
export async function loadPadEnvData(io: PadIo, idx: PadIndexData, info: PadInfo, r: Req = {}): Promise<PadEnv> {
  const keys = info.files.fields
  if (!keys) throw new PadError(info.id, 'no-routing-fields', `pad ${info.id} has no routing fields`)
  const fi = idx.fields
  const L = padLoader(io, r)
  const [tHome, o2Home, pointer, summaryRaw] = await Promise.all([
    loadFieldGrid(io, fi, keys.tHome, r),
    fi.fields[keys.o2Home] ? loadFieldGrid(io, fi, keys.o2Home, r) : Promise.resolve(null),
    fi.fields[keys.pointer]?.stencil ? loadPointerField(io, fi, keys.pointer, r) : Promise.resolve(null),
    info.files.summary ? L.optional(() => L.json<unknown>(info.files.summary!)).catch((e) => (isAbortError(e) ? Promise.reject(e) : null)) : Promise.resolve(null),
  ])
  check(r)
  let summary: PadEnv['summary'] = null
  try {
    summary = summaryRaw ? parsePadSummary(summaryRaw, info.sourceId) : null
  } catch {
    summary = null // the card shows no numbers rather than wrong ones
  }
  const routingFields: RoutingFields = { padId: info.id, scenario: idx.scenario, pad: { lon: info.lon, lat: info.lat, elevM: info.elevM }, tHome, o2Home, pointer }
  return { info, routingFields, summary, planProducts: lazyProducts(io, info.files) }
}

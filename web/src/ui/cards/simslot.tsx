// "Send to simulator" slot (D76 slot, package A5s; D103 format, D110 main feature for the ship), on
// the plan / route-summary card and in the Report view. Behind VITE_SIM_EXPORT, default off
// (simExportMode, D116): 'official' = the official plan only, from the static file, no API call;
// 'all' (or 1/true) = also live results (npm run dev:live-demo). Unset, the build is unchanged.
//
// The simulator's plan format is mission.json (contracts/bundle/mission.schema.json, D103):
//  - With no props the slot sits on the app's own loaded tree, which is the official plan. Its
//    mission.json is WP9c's static file sim/official/mission.json (dataUrl-relative
//    OFFICIAL_MISSION_PATH; a sim_plan mission.json entry of the loaded manifest, if one appears, is
//    tried before it). While the live layer is reachable it registers the API's copy of the same
//    file (/results/{official_hash}/mission.json, setOfficialMissionSource), which is tried first.
//  - With `manifest` (+ `base`, a live result tree) it lists the manifest's entries of kind
//    "sim_plan" (WP9b writes results/{hash}/mission.json with that kind).
// The slot checks that the file is there (404 → MISSION_TEXT.missing, from this module, not
// copy.json) and reads only its schema_version, with a regex; the plan inside is never parsed.
// Hooks for the WP8c harness (scenarios h and i) and the waypoint harness (SIM-1): the control carries
// data-sim-export (checking | ready | failed; missing on the message), data-origin (computed_live |
// precomputed) and data-state (idle | downloading | done | unavailable). The download goes through
// fetch -> Blob -> object URL (downloadMission): a cross-origin <a download> would open the JSON.
// Self-contained stateful component for other mounts (Edit-route panel, WP12): SendToSimulator in
// simslot-export.tsx.
//
// Independent of src/live/simslot.tsx on purpose: the static app may not import src/live/
// (live/isolation.test.ts). src/live imports the helpers below instead.
import type { Manifest } from '../../data/types'
import { DATA_MODE, dataUrl } from '../../env'
import { getManifest } from '../../prov/store'
import { t } from '../copy'
import { Icon } from '../components'
// No other import here: the import list stays that of the D76 slot, so a flag-off build is
// byte-identical (a new preact or preact/hooks import reorders the chunk's imports even when the body
// folds away). The stateful part lives in simslot-export.tsx, imported only behind the flag.

const SIM_PLAN_KIND = 'sim_plan'

/** The simulator plan's file name (D103); also the download name. */
export const MISSION_FILE = 'mission.json'
/** WP9c's official mission.json (web/public/sim/official/mission.json), relative to the data dir. */
export const OFFICIAL_MISSION_PATH = '../sim/official/mission.json'

/** UI text of the slot (not copy.json, which ships in the static bundle). */
export const MISSION_TEXT = {
  missing: 'Simulator file not available for this plan',
  checking: 'Checking the simulator file…',
  download: 'Download mission.json',
  official: 'Official plan · precomputed',
  live: 'This plan · computed live',
  noVersion: 'format version not stated',
  failed: (why: string) => `Could not check the file (${why}); the link may still work`,
  saved: 'mission.json saved',
  downloadFailed: (why: string) => `Download failed (${why})`,
  format: (v: string) => `mission.json format ${v}`,
} as const

/** Who computed the plan: the hooks' data-origin. */
export type MissionOrigin = 'computed_live' | 'precomputed'

export type MissionProbe =
  | { state: 'checking' }
  | { state: 'ok'; url: string; version: string | null; text: string }
  | { state: 'missing' }
  | { state: 'failed'; message: string }

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>

const MISSION_KIND_RE = /"kind"\s*:\s*"homeline_mission"/
const VERSION_RE = /"schema_version"\s*:\s*"([^"\\]{1,32})"/

/** schema_version of a mission.json text, read without parsing the plan (null when absent). */
export function missionVersion(text: string): string | null {
  return VERSION_RE.exec(text)?.[1] ?? null
}

/** A mission.json body (kind homeline_mission), not e.g. a dev server's HTML fallback page. */
export function isMissionText(text: string): boolean {
  return MISSION_KIND_RE.test(text)
}

/**
 * The first of `urls` that answers with a mission.json. 404 (or a body that is not one) on every URL
 * → missing; any other failure → failed with the first reason (the link is still offered).
 */
export async function probeMission(urls: readonly string[], fetchFor: (url: string) => FetchFn = () => fetch, signal?: AbortSignal): Promise<MissionProbe> {
  let failed: string | null = null
  for (const url of urls) {
    try {
      const res = await fetchFor(url)(url, signal ? { signal } : undefined)
      if (res.ok) {
        const text = await res.text()
        if (isMissionText(text)) return { state: 'ok', url, version: missionVersion(text), text }
      } else if (res.status !== 404) failed ??= `HTTP ${res.status}`
    } catch (e) {
      if (signal?.aborted) throw e
      failed ??= e instanceof Error ? e.message : String(e)
    }
  }
  return failed ? { state: 'failed', message: failed } : { state: 'missing' }
}

/** The control's data-state hook (WP8c / waypoint harness, SIM-1). */
export type MissionState = 'idle' | 'downloading' | 'done' | 'unavailable'

/** Per-URL fetch (the live dev mock answers API URLs; default the global fetch). */
export type MissionFetchFor = (url: string) => FetchFn

/** Save `text` as mission.json: Blob -> object URL -> a[download] click -> revoke. */
export function saveMissionText(text: string, name: string = MISSION_FILE): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = name
    document.body.appendChild(a)
    a.click()
    a.remove()
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
}

/**
 * Download the plan's mission.json through fetch -> Blob -> object URL (SIM-1): a plain cross-origin
 * <a download> (demo web on 5173, API on 8012; Pages vs the API host) opens the JSON in the tab
 * instead. `text` = the body the check already fetched (no second request). 404 or a body that is
 * not a mission -> unavailable (missing); anything else that fails -> unavailable with the reason.
 */
export async function downloadMission(url: string, text: string | null, fetchFor: MissionFetchFor = () => fetch): Promise<{ state: 'done' } | { state: 'unavailable'; reason: string | null }> {
  try {
    let body = text
    if (body === null) {
      const res = await fetchFor(url)(url)
      if (res.status === 404) return { state: 'unavailable', reason: null }
      if (!res.ok) return { state: 'unavailable', reason: `HTTP ${res.status}` }
      body = await res.text()
    }
    if (!isMissionText(body)) return { state: 'unavailable', reason: null }
    saveMissionText(body)
    return { state: 'done' }
  } catch (e) {
    return { state: 'unavailable', reason: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Attributes of the download control: the hooks (data-sim-export, data-origin, data-state) and a
 * click that runs downloadMission and writes the outcome to data-state and the [data-sim-status]
 * line next to it (no component state, so pure views can use it).
 */
export function missionControlProps(probe: MissionProbe, href: string, origin: MissionOrigin, fetchFor?: MissionFetchFor) {
  return {
    href,
    download: MISSION_FILE,
    'data-sim-export': probe.state === 'ok' ? 'ready' : probe.state,
    'data-origin': origin,
    'data-state': 'idle' as MissionState,
    onClick: (e: MouseEvent) => {
      e.preventDefault()
      const a = e.currentTarget as HTMLElement
      if (a.getAttribute('data-state') === 'downloading') return
      const status = a.parentElement?.querySelector('[data-sim-status]') ?? null
      a.setAttribute('data-state', 'downloading')
      void downloadMission(probe.state === 'ok' ? probe.url : href, probe.state === 'ok' ? probe.text : null, fetchFor).then((r) => {
        a.setAttribute('data-state', r.state)
        if (status) status.textContent = r.state === 'done' ? MISSION_TEXT.saved : r.reason ? MISSION_TEXT.downloadFailed(r.reason) : MISSION_TEXT.missing
      })
    },
  }
}

/** The static official mission.json URL (dataUrl-relative, real data tree). */
export const officialMissionUrl = (): string => dataUrl(OFFICIAL_MISSION_PATH, 'real')

export interface OfficialMissionSource {
  /** e.g. {API}/results/{official_hash}/mission.json */
  url: string
  /** Fetch for that URL (the live layer's mock in VITE_LIVE_MOCK builds); default fetch. */
  fetch?: FetchFn
}
let officialSource: OfficialMissionSource | null = null
let officialSubs: Set<(s: OfficialMissionSource | null) => void> | undefined

/** Live layer only: the API's copy of the official mission.json while live is reachable, or null. */
export function setOfficialMissionSource(s: OfficialMissionSource | null): void {
  officialSource = s
  for (const fn of officialSubs ?? []) fn(s)
}

/** The registered API copy now, and a subscription to changes (returns unsubscribe). */
export function officialMissionSource(fn?: (s: OfficialMissionSource | null) => void): { now: OfficialMissionSource | null; off: () => void } {
  if (fn) (officialSubs ??= new Set()).add(fn)
  return { now: officialSource, off: () => void (fn && officialSubs?.delete(fn)) }
}

/**
 * Candidate URLs of the official plan's mission.json, best first: the API copy (mode all, when
 * registered), a sim_plan mission.json entry of the loaded static manifest (if one appears), WP9c's
 * static file.
 */
export function officialMissionUrls(src: OfficialMissionSource | null): string[] {
  const own = simPlanFiles(getManifest()).find((f) => f.file.split('/').pop() === MISSION_FILE)
  const all = [src?.url, own ? dataUrl(own.file, 'real') : undefined, officialMissionUrl()]
  return [...new Set(all.filter((u): u is string => !!u))]
}

/** Ref of the official slot's body: simslot-export.tsx renders the checked control into it. */
function officialRef(apiFirst: boolean): (el: Element | null) => void {
  return (el) => {
    if (el) void import('./simslot-export').then((m) => m.mountOfficialMission(el, apiFirst))
  }
}

/**
 * VITE_SIM_EXPORT (D116): 'official' = the official plan only, from the static file (no API call);
 * '1', 'true' or 'all' = the official plan and live results; unset or anything else = off. Same rule
 * as live/config.ts simExportModeFrom (the static app may not import src/live/). Vite inlines the
 * value at build time, so with the flag off the slot's body folds away.
 */
export function simExportMode(): 'off' | 'official' | 'all' {
  const v = import.meta.env.VITE_SIM_EXPORT
  return v === 'official' ? 'official' : v === '1' || v === 'true' || v === 'all' ? 'all' : 'off'
}

/** The slot is on in some mode (official or all). */
export function simExportOn(): boolean {
  return simExportMode() !== 'off'
}

export interface SimPlanFile {
  /** Manifest key of the entry. */
  key: string
  /** Path in the result tree, exactly as the manifest gives it. */
  file: string
}

/** Every manifest entry of kind sim_plan, one per file, sorted by path. */
export function simPlanFiles(manifest: Manifest | null | undefined): SimPlanFile[] {
  const out = new Map<string, SimPlanFile>()
  for (const [key, e] of Object.entries((manifest ?? {}) as Record<string, unknown>)) {
    const x = e as { kind?: unknown; file?: unknown } | null
    if (x && x.kind === SIM_PLAN_KIND && typeof x.file === 'string' && x.file && !out.has(x.file)) out.set(x.file, { key, file: x.file })
  }
  return [...out.values()].sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))
}

export interface SimSlotProps {
  /** A result tree's manifest; omitted: the app's own loaded tree, i.e. the official plan. */
  manifest?: Manifest | null
  /** Root URL of that result tree (e.g. a live result); default: the static data tree. */
  base?: string
}

export function SimSlot({ manifest, base }: SimSlotProps) {
  // Same test as simExportOn(), written inline so the minifier folds it and drops the rest when off.
  const v = import.meta.env.VITE_SIM_EXPORT
  if (!(v === '1' || v === 'true' || v === 'all' || v === 'official')) return null
  if (manifest === undefined && base === undefined) return DATA_MODE === 'real' ? <OfficialSlot apiFirst={v !== 'official'} /> : null
  // D116 'official': the official plan only
  return v === 'official' ? null : <ManifestFiles manifest={manifest ?? null} base={base} />
}

/** The official plan's slot; its body (the checked download control) is filled in by simslot-export.tsx. */
function OfficialSlot({ apiFirst }: { apiFirst: boolean }) {
  return (
    <section class="hl-simslot" data-slot="sim" aria-label={t('simulator.sendSlot')}>
      <h4 class="hl-cardx__h">{t('simulator.sendSlot')}</h4>
      <p class="hl-cardx__muted">{MISSION_TEXT.official}</p>
      <div class="hl-simslot__official" ref={officialRef(apiFirst)} />
    </section>
  )
}

/** Download control + format line, or the honest "not available" message on 404. */
export function MissionControl({ probe, href, origin, fetchFor }: { probe: MissionProbe; href: string; origin: MissionOrigin; fetchFor?: MissionFetchFor }) {
  if (probe.state === 'missing') {
    return (
      <p class="hl-cardx__muted" role="status" data-sim-export="missing" data-origin={origin} data-state="unavailable">
        {MISSION_TEXT.missing}
      </p>
    )
  }
  return (
    <p class="hl-cardx__muted">
      <a class="hl-simslot__file" {...missionControlProps(probe, href, origin, fetchFor)}>
        <Icon name="download" />
        <span>{MISSION_TEXT.download}</span>
      </a>{' '}
      <span data-sim-status="" data-sim-version={probe.state === 'ok' ? (probe.version ?? '') : undefined} role="status">
        {missionNote(probe)}
      </span>
    </p>
  )
}

/** The line next to the control: format version, check in progress or why the check failed. */
export function missionNote(probe: MissionProbe): string {
  return probe.state === 'ok' ? (probe.version ? MISSION_TEXT.format(probe.version) : MISSION_TEXT.noVersion) : probe.state === 'failed' ? MISSION_TEXT.failed(probe.message) : probe.state === 'checking' ? MISSION_TEXT.checking : ''
}

/** A live result's or the official plan's mission.json: origin and candidate URLs, best first. */
export interface MissionTarget {
  origin: MissionOrigin
  urls: string[]
}

/**
 * Where a plan's mission.json is (D110, D116). Null when there is no plan (no manifest and no
 * origin), or in mode 'official' for anything but the official plan, which that mode reads from
 * the static file only. Live result: its sim_plan entry (preferring mission.json), else
 * {base}/mission.json. Official plan (precomputed): {base}/mission.json on the API, then the static
 * file. A missing origin counts as computed live.
 */
export function missionTargetFor(manifest: Manifest | null | undefined, base: string, origin?: MissionOrigin | null, mode: 'official' | 'all' = 'all'): MissionTarget | null {
  if (!manifest && !origin) return null
  if (mode === 'official') return origin === 'precomputed' ? { origin: 'precomputed', urls: [officialMissionUrl()] } : null
  const files = simPlanFiles(manifest)
  const declared = (files.find((f) => f.file.split('/').pop() === MISSION_FILE) ?? files[0])?.file
  const fromTree = dataUrl(declared ?? MISSION_FILE, 'real', base)
  if (origin === 'precomputed') return { origin: 'precomputed', urls: [...new Set([fromTree, officialMissionUrl()])] }
  return { origin: 'computed_live', urls: [fromTree] }
}

/** A result tree's sim_plan entries, as the manifest gives them. */
function ManifestFiles({ manifest, base }: { manifest: Manifest | null; base?: string }) {
  const files = simPlanFiles(manifest)
  if (!files.length) return null
  const origin: MissionOrigin = base ? 'computed_live' : 'precomputed'
  return (
    <section class="hl-simslot" data-slot="sim" aria-label={t('simulator.sendSlot')}>
      <h4 class="hl-cardx__h">{t('simulator.sendSlot')}</h4>
      <p class="hl-cardx__muted">{t('simulator.sendSlotHint')}</p>
      <ul class="hl-cardx__list">
        {files.map((f) => (
          <li>
            <a class="hl-simslot__file" href={dataUrl(f.file, DATA_MODE, base)} download={f.file.split('/').filter(Boolean).pop() ?? f.file} title={`manifest: ${f.key}`} data-sim-export="ready" data-origin={origin}>
              <Icon name="download" />
              <span>{f.file}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}

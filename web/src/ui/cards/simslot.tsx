// "Send to simulator" slot (D76 slot, package A5s; D103 format, D110 main feature for the ship), on
// the plan / route-summary card and in the Report view. Behind VITE_SIM_EXPORT, default off: only
// the live demo build turns it on (npm run dev:live-demo), never the static or Pages build.
//
// The simulator's plan format is mission.json (contracts/bundle/mission.schema.json, D103):
//  - With no props the slot sits on the app's own loaded tree, which is the official plan. Its
//    mission.json is WP9c's static file sim/official/mission.json (dataUrl-relative
//    OFFICIAL_MISSION_PATH). While the live layer is reachable it registers the API's copy of the same
//    file (/results/{official_hash}/mission.json, setOfficialMissionSource), which is tried first.
//  - With `manifest` (+ `base`, a live result tree) it lists the manifest's entries of kind
//    "sim_plan" (WP9b writes results/{hash}/mission.json with that kind).
// The slot checks that the file is there (404 → MISSION_TEXT.missing, from this module, not
// copy.json) and reads only its schema_version, with a regex; the plan inside is never parsed.
// Hooks for the WP8c harness (scenarios h and i): the control carries data-sim-export
// (checking | ready | failed; missing on the message) and data-origin (computed_live | precomputed).
//
// Independent of src/live/simslot.tsx on purpose: the static app may not import src/live/
// (live/isolation.test.ts). src/live imports the helpers below instead.
import { useEffect, useState } from 'preact/hooks'
import type { Manifest } from '../../data/types'
import { DATA_MODE, dataUrl } from '../../env'
import { t } from '../copy'
import { Icon } from '../components'

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

/** Save `text` as a file through a blob URL (works for a cross-origin API too). False if it could not. */
export function saveMissionText(text: string, name: string = MISSION_FILE): boolean {
  try {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = name
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    return true
  } catch {
    return false
  }
}

/** Click on a download link: the checked text as a blob when there is one, else the plain link. */
export function onMissionClick(probe: MissionProbe): (e: MouseEvent) => void {
  return (e) => {
    if (probe.state === 'ok' && saveMissionText(probe.text)) e.preventDefault()
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

/**
 * VITE_SIM_EXPORT, read like VITE_LIVE ('1' or 'true' = on, anything else or unset = off). Vite inlines
 * the value at build time, so with the flag off the slot's body folds away.
 */
export function simExportOn(): boolean {
  return import.meta.env.VITE_SIM_EXPORT === '1' || import.meta.env.VITE_SIM_EXPORT === 'true'
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
  if (!(import.meta.env.VITE_SIM_EXPORT === '1' || import.meta.env.VITE_SIM_EXPORT === 'true')) return null
  if (manifest === undefined && base === undefined) return DATA_MODE === 'real' ? <OfficialMission /> : null
  return <ManifestFiles manifest={manifest ?? null} base={base} />
}

/** The official plan's mission.json: the API's copy first when registered, else the static file. */
function OfficialMission() {
  const [src, setSrc] = useState(officialSource)
  const [probe, setProbe] = useState<MissionProbe>({ state: 'checking' })
  useEffect(() => {
    const subs = (officialSubs ??= new Set())
    subs.add(setSrc)
    return () => void subs.delete(setSrc)
  }, [])
  const staticUrl = officialMissionUrl()
  const urls = src ? [src.url, staticUrl] : [staticUrl]
  useEffect(() => {
    const ac = new AbortController()
    setProbe({ state: 'checking' })
    probeMission(urls, (u) => (src && u === src.url && src.fetch) || fetch, ac.signal).then(
      (p) => !ac.signal.aborted && setProbe(p),
      () => {},
    )
    return () => ac.abort()
  }, [urls.join('\n')])
  return (
    <section class="hl-simslot" data-slot="sim" aria-label={t('simulator.sendSlot')}>
      <h4 class="hl-cardx__h">{t('simulator.sendSlot')}</h4>
      <p class="hl-cardx__muted">{MISSION_TEXT.official}</p>
      <MissionControl probe={probe} href={probe.state === 'ok' ? probe.url : urls[0]} origin="precomputed" />
    </section>
  )
}

/** Download control + format line, or the honest "not available" message on 404. */
export function MissionControl({ probe, href, origin }: { probe: MissionProbe; href: string; origin: MissionOrigin }) {
  if (probe.state === 'missing') {
    return (
      <p class="hl-cardx__muted" role="status" data-sim-export="missing" data-origin={origin}>
        {MISSION_TEXT.missing}
      </p>
    )
  }
  const note = probe.state === 'ok' ? (probe.version ? MISSION_TEXT.format(probe.version) : MISSION_TEXT.noVersion) : probe.state === 'failed' ? MISSION_TEXT.failed(probe.message) : MISSION_TEXT.checking
  return (
    <p class="hl-cardx__muted">
      <a class="hl-simslot__file" href={href} download={MISSION_FILE} data-sim-export={probe.state === 'ok' ? 'ready' : probe.state} data-origin={origin} onClick={onMissionClick(probe)}>
        <Icon name="download" />
        <span>{MISSION_TEXT.download}</span>
      </a>{' '}
      <span data-sim-version={probe.state === 'ok' ? (probe.version ?? '') : undefined} role="status">
        {note}
      </span>
    </p>
  )
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

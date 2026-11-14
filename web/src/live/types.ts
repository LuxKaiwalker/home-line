// Hand-written types for the parts of contracts/backend/openapi.yaml (v1.0.1, frozen) the live
// client uses. contract.test.ts checks every key map and enum below against the schema, so a
// contract change that these types miss fails the tests.

export type HeavyJobs = 'on' | 'off'

/** components.schemas.Health */
export interface Health {
  ok: boolean
  engine_warm: boolean
  queue_length: number
  heavy_jobs: HeavyJobs
}

/** components.schemas.Error */
export interface ApiErrorBody {
  error: string
  detail?: unknown
  retry_after_s?: number | null
  allowed?: Record<string, unknown> | null
}

export const JOB_TYPES = ['plan', 'siting', 'replan'] as const
export type JobType = (typeof JOB_TYPES)[number]

export const JOB_STATUSES = ['queued', 'running', 'done', 'error', 'timeout', 'refused'] as const
export type JobStatus = (typeof JOB_STATUSES)[number]
/** Statuses after which the server never changes the job again. */
export const JOB_FAILED_STATUSES: readonly JobStatus[] = ['error', 'timeout', 'refused']

/** contracts/backend/job.schema.json */
export interface Job {
  id: string
  type: JobType
  hash: string
  status: JobStatus
  /** Stage now running (a free string in the contract); null when queued or finished. */
  stage?: string | null
  progress: number
  /** Finished stages in order; their files are already readable under result_url. */
  stages_done: string[]
  queue_position?: number | null
  result_url?: string | null
  attached?: boolean
  error?: string | null
  retry_after_s?: number | null
}

/** contracts/backend/plan_inputs.schema.json (opaque here; the pad tool and crew panel own its shape). */
export type PlanInputs = Record<string, unknown>

/** components.schemas.ReplanInputs (opaque here; F32 owns it). */
export type ReplanInputs = Record<string, unknown>

/** components.schemas.JobRequest */
export interface JobRequest {
  type: JobType
  inputs: PlanInputs
  replan?: ReplanInputs
}

/** components.schemas.LonLat */
export interface LonLat {
  lon: number
  lat: number
}

export const PAD_REASONS = [null, 'slope', 'unknown_terrain', 'disc_off_grid', 'outside_grid'] as const
export type PadReason = (typeof PAD_REASONS)[number]

/** components.schemas.PadCheck */
export interface PadCheck {
  valid: boolean
  reason: PadReason
  detail?: string
  nearest_valid?: { lon: number; lat: number; distance_m: number } | null
}

/** components.schemas.PadScreen */
export interface PadScreen {
  pad: LonLat
  stations: { id: string; reachable: boolean; t_out_min?: number | null; t_home_min?: number | null }[]
  feasible_evas: number
  best_route?: { order: string[]; total_min: number } | null
  label: string
}

/** components.schemas.EngineVersion */
export interface EngineVersion {
  engine_tree: string
  commit: string
  config_hash: string
  web_contract_version: string
  backend_contract_version: string
  bundle_contract_version?: string
  terrain_hash: string
  world_version?: string
}

/** components.schemas.ImportResult */
export interface ImportResult {
  hash: string
  inputs: PlanInputs
  computed?: boolean
  range_flags?: Record<string, unknown>[]
}

// Exhaustive key maps (a missing or extra key is a type error); contract.test.ts compares them to
// the schema's properties and required lists.
type KeyMap<T> = { [K in keyof Required<T>]: undefined extends T[K] ? 'optional' : 'required' }

export const HEALTH_KEYS: KeyMap<Health> = { ok: 'required', engine_warm: 'required', queue_length: 'required', heavy_jobs: 'required' }
export const JOB_KEYS: KeyMap<Job> = {
  id: 'required', type: 'required', hash: 'required', status: 'required', stage: 'optional', progress: 'required',
  stages_done: 'required', queue_position: 'optional', result_url: 'optional', attached: 'optional', error: 'optional',
  retry_after_s: 'optional',
}
export const ERROR_KEYS: KeyMap<ApiErrorBody> = { error: 'required', detail: 'optional', retry_after_s: 'optional', allowed: 'optional' }
export const JOB_REQUEST_KEYS: KeyMap<JobRequest> = { type: 'required', inputs: 'required', replan: 'optional' }
export const PAD_CHECK_KEYS: KeyMap<PadCheck> = { valid: 'required', reason: 'required', detail: 'optional', nearest_valid: 'optional' }
export const PAD_SCREEN_KEYS: KeyMap<PadScreen> = { pad: 'required', stations: 'required', feasible_evas: 'required', best_route: 'optional', label: 'required' }
export const ENGINE_VERSION_KEYS: KeyMap<EngineVersion> = {
  engine_tree: 'required', commit: 'required', config_hash: 'required', web_contract_version: 'required',
  backend_contract_version: 'required', bundle_contract_version: 'optional', terrain_hash: 'required', world_version: 'optional',
}
export const IMPORT_RESULT_KEYS: KeyMap<ImportResult> = { hash: 'required', inputs: 'required', computed: 'optional', range_flags: 'optional' }

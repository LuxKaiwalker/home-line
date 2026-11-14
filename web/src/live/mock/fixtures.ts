// Mock responses for the live API. Recorded ones are the contract examples themselves
// (contracts/backend/examples, referenced by openapi.yaml externalValue); the rest are derived
// from them or written to the schema where the contract has no example (Health). contract.test.ts
// validates every fixture against openapi.yaml. Hashes and numbers are placeholders, not results.
import jobQueuedExample from '../../../../contracts/backend/examples/job.queued.json'
import jobRunningExample from '../../../../contracts/backend/examples/job.running.json'
import planInputsOfficial from '../../../../contracts/backend/examples/plan_inputs.official.json'
import runRecordLive from '../../../../contracts/backend/examples/run_record.live.json'
import { PRECOMPUTED_LABEL } from '../config'
import type { Health, Job, PlanInputs, RunRecord } from '../types'
import { MOCK_OFFICIAL_HASH } from './hashes'

export const HEALTH_WARM: Health = { ok: true, engine_warm: true, queue_length: 0, heavy_jobs: 'on' }
export const HEALTH_COLD: Health = { ok: true, engine_warm: false, queue_length: 0, heavy_jobs: 'on' }
export const HEALTH_NOT_OK: Health = { ok: false, engine_warm: false, queue_length: 0, heavy_jobs: 'on' }

/** Recorded: contracts/backend/examples/job.queued.json (POST /jobs 202 example). */
export const JOB_QUEUED = jobQueuedExample as Job
/** Recorded: contracts/backend/examples/job.running.json (GET /jobs/{id} 200 example). */
export const JOB_RUNNING = jobRunningExample as Job

/**
 * Stage names of the mock plan job. The contract leaves stage names free (job.schema.json); the
 * first two are the examples' ('nominal', 'bands'), the third stands for F24's last stage (HUD
 * fields, partner line, horizon). The client treats stage names as opaque strings.
 */
export const MOCK_STAGES = ['nominal', 'bands', 'hud'] as const

const RESULT_URL = JOB_RUNNING.result_url ?? null

/** Derived from the examples: queued -> one running state per stage -> done. */
export function jobScript(stages: readonly string[] = MOCK_STAGES): Job[] {
  const out: Job[] = [{ ...JOB_QUEUED }]
  stages.forEach((stage, i) => {
    out.push({
      ...JOB_RUNNING,
      stage,
      progress: i / stages.length,
      stages_done: stages.slice(0, i),
      result_url: i > 0 ? RESULT_URL : null,
    })
  })
  out.push({ ...JOB_RUNNING, status: 'done', stage: null, progress: 1, stages_done: [...stages], result_url: RESULT_URL })
  return out
}

/** Derived: a job that fails during its second stage. */
export function failedJobScript(error = 'engine_error: no route within the walkback budget'): Job[] {
  const s = jobScript()
  return [s[0], s[1], s[2], { ...s[2], status: 'error', stage: null, error }]
}

export const PLAN_INPUTS_OFFICIAL = planInputsOfficial as PlanInputs
export const RUN_RECORD_LIVE: unknown = runRecordLive

/**
 * Derived: the run record of the official (precomputed) tree, as E3 synthesises it
 * (server/engine/results.py precomputed_run_record): origin precomputed, labels.precomputed, the
 * official inputs, no stages. Engine ids and hashes are the example's placeholders.
 */
export const RUN_RECORD_OFFICIAL: RunRecord = {
  ...(runRecordLive as RunRecord),
  hash: MOCK_OFFICIAL_HASH,
  origin: 'precomputed',
  label: PRECOMPUTED_LABEL,
  inputs: { ...(planInputsOfficial as PlanInputs), stations: { mode: 'best' } },
  stages: [],
  files: [],
  range_flags: [],
  infeasible: null,
  error: null,
  dummy: false,
}

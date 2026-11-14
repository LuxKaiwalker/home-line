// The hand-written API types and every mock response checked against contracts/backend/openapi.yaml
// (v1.0.1, frozen). Light check: $refs are inlined, then the app's own JSON Schema subset checker
// (src/data/schema.ts) runs; a keyword it does not know fails the test instead of passing silently.
import { describe, expect, it } from 'vitest'
import openapi from '../../../contracts/backend/openapi.yaml'
import jobSchema from '../../../contracts/backend/job.schema.json'
import planInputsSchema from '../../../contracts/backend/plan_inputs.schema.json'
import runRecordSchema from '../../../contracts/backend/run_record.schema.json'
import telemetrySchema from '../../../contracts/backend/telemetry.schema.json'
import { checkSchema, SUPPORTED_KEYWORDS, type JsonSchema } from '../data/schema'
import { createApiClient } from './client'
import { HEALTH_COLD, HEALTH_NOT_OK, HEALTH_WARM, failedJobScript, jobScript, PLAN_INPUTS_OFFICIAL, RUN_RECORD_LIVE } from './mock/fixtures'
import { createMockFetch } from './mock/fetch'
import {
  ENGINE_VERSION_KEYS, ERROR_KEYS, HEALTH_KEYS, IMPORT_RESULT_KEYS, JOB_KEYS, JOB_REQUEST_KEYS, JOB_STATUSES, JOB_TYPES,
  PAD_CHECK_KEYS, PAD_REASONS, PAD_SCREEN_KEYS,
} from './types'

type Doc = Record<string, unknown>
const DOCS: Record<string, Doc> = {
  'openapi.yaml': openapi as Doc,
  'job.schema.json': jobSchema as Doc,
  'plan_inputs.schema.json': planInputsSchema as Doc,
  'run_record.schema.json': runRecordSchema as Doc,
  'telemetry.schema.json': telemetrySchema as Doc,
}

function pointer(doc: Doc, ptr: string): unknown {
  let cur: unknown = doc
  for (const part of ptr.replace(/^\//, '').split('/').filter(Boolean)) cur = (cur as Doc)[part.replace(/~1/g, '/').replace(/~0/g, '~')]
  if (cur === undefined) throw new Error(`unresolved pointer ${ptr}`)
  return cur
}

/** Inline every $ref (local and to the sibling contract files); siblings of a $ref are kept via allOf. */
function deref(node: unknown, file: string, depth = 0): unknown {
  if (depth > 50) throw new Error('$ref cycle')
  if (Array.isArray(node)) return node.map((n) => deref(n, file, depth))
  if (!node || typeof node !== 'object') return node
  const o = node as Doc
  if (typeof o.$ref === 'string') {
    const [target, frag = ''] = o.$ref.split('#')
    const tfile = target || file
    const doc = DOCS[tfile]
    if (!doc) throw new Error(`unknown $ref file ${tfile}`)
    const resolved = deref(frag ? pointer(doc, frag) : doc, tfile, depth + 1)
    const { $ref: _ignored, ...rest } = o
    void _ignored
    return Object.keys(rest).length ? { ...(deref(rest, file, depth) as Doc), allOf: [resolved] } : resolved
  }
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, k === 'properties' ? derefMap(v, file, depth) : deref(v, file, depth)]))
}
function derefMap(v: unknown, file: string, depth: number): unknown {
  return Object.fromEntries(Object.entries(v as Doc).map(([k, s]) => [k, deref(s, file, depth)]))
}

function keywordsIn(s: unknown, out = new Set<string>(), namesOnly = false): Set<string> {
  if (Array.isArray(s)) s.forEach((x) => keywordsIn(x, out))
  else if (s && typeof s === 'object') {
    for (const [k, v] of Object.entries(s as Doc)) {
      if (namesOnly) keywordsIn(v, out)
      else {
        out.add(k)
        // property names and $defs names are not keywords; enum/const values are data
        if (k === 'enum' || k === 'const' || k === 'examples') continue
        keywordsIn(v, out, k === 'properties' || k === '$defs')
      }
    }
  }
  return out
}

// Keywords plan_inputs/run_record use beyond the app checker's subset, checked here (test only).
const EXTRA = new Set(['oneOf', 'uniqueItems', 'propertyNames'])
const OPENAPI_ANNOTATIONS = new Set(['$defs', 'contentMediaType'])
function assertKnown(s: JsonSchema, what: string): JsonSchema {
  const unknown = [...keywordsIn(s)].filter((k) => !SUPPORTED_KEYWORDS.has(k) && !OPENAPI_ANNOTATIONS.has(k) && !EXTRA.has(k))
  expect(unknown, `${what} uses keywords this light check does not support`).toEqual([])
  return s
}
function schemaOf(ref: string): JsonSchema {
  return assertKnown(deref({ $ref: ref }, 'openapi.yaml') as JsonSchema, ref)
}
function responseSchema(method: string, path: string, status: number): JsonSchema {
  const op = pointer(openapi as Doc, `/paths/${path.replace(/\//g, '~1')}/${method.toLowerCase()}`) as Doc
  const resp = deref((op.responses as Doc)[String(status)], 'openapi.yaml') as Doc
  return assertKnown(pointer(resp, '/content/application~1json/schema') as JsonSchema, `${method} ${path} ${status}`)
}

/** checkSchema plus oneOf, uniqueItems and propertyNames, applied wherever they sit in the schema. */
function validate(v: unknown, s: JsonSchema, path = '$'): string[] {
  const out = checkSchema(v, s, path).map((e) => `${e.path}: ${e.message}`)
  return out.length ? out : extras(v, s, path)
}
function extras(v: unknown, s: JsonSchema, path: string): string[] {
  const out: string[] = []
  if (Array.isArray(s.oneOf)) {
    const n = (s.oneOf as JsonSchema[]).filter((b) => validate(v, b, path).length === 0).length
    if (n !== 1) out.push(`${path}: matches ${n} oneOf branches`)
  }
  if (Array.isArray(s.allOf)) for (const b of s.allOf as JsonSchema[]) out.push(...extras(v, b, path))
  if (Array.isArray(v)) {
    if (s.uniqueItems === true && new Set(v.map((x) => JSON.stringify(x))).size !== v.length) out.push(`${path}: items not unique`)
    if (s.items && typeof s.items === 'object') v.forEach((x, i) => out.push(...extras(x, s.items as JsonSchema, `${path}[${i}]`)))
  } else if (v && typeof v === 'object') {
    const o = v as Doc
    if (s.propertyNames && typeof s.propertyNames === 'object') {
      for (const k of Object.keys(o)) out.push(...validate(k, s.propertyNames as JsonSchema, `${path}.<${k}>`))
    }
    const props = (s.properties as Record<string, JsonSchema> | undefined) ?? {}
    for (const [k, x] of Object.entries(o)) {
      if (k in props) out.push(...extras(x, props[k], `${path}.${k}`))
      else if (s.additionalProperties && typeof s.additionalProperties === 'object') out.push(...extras(x, s.additionalProperties as JsonSchema, `${path}.${k}`))
    }
  }
  return out
}

const valid = (v: unknown, s: JsonSchema) => expect(validate(v, s)).toEqual([])

describe('hand-written types match openapi.yaml', () => {
  const cases: [string, Record<string, 'required' | 'optional'>][] = [
    ['Health', HEALTH_KEYS], ['Job', JOB_KEYS], ['Error', ERROR_KEYS], ['JobRequest', JOB_REQUEST_KEYS],
    ['PadCheck', PAD_CHECK_KEYS], ['PadScreen', PAD_SCREEN_KEYS], ['EngineVersion', ENGINE_VERSION_KEYS],
    ['ImportResult', IMPORT_RESULT_KEYS],
  ]
  it.each(cases)('%s: same properties and required list', (name, keys) => {
    const s = schemaOf(`#/components/schemas/${name}`) as Doc
    expect(Object.keys(keys).sort()).toEqual(Object.keys(s.properties as Doc).sort())
    const required = Object.entries(keys).filter(([, r]) => r === 'required').map(([k]) => k).sort()
    expect(required).toEqual([...((s.required as string[]) ?? [])].sort())
  })
  it('enums: job type, job status, pad reason', () => {
    const job = schemaOf('#/components/schemas/Job') as { properties: Record<string, { enum: unknown[] }> }
    expect([...JOB_TYPES]).toEqual(job.properties.type.enum)
    expect([...JOB_STATUSES]).toEqual(job.properties.status.enum)
    const pad = schemaOf('#/components/schemas/PadCheck') as { properties: Record<string, { enum: unknown[] }> }
    expect([...PAD_REASONS]).toEqual(pad.properties.reason.enum)
  })
  it('the check is not vacuous: bad documents fail', () => {
    const job = schemaOf('#/components/schemas/Job')
    expect(validate({ ...jobScript()[0], status: 'finished' }, job)).not.toEqual([])
    expect(validate({ ...jobScript()[0], extra: 1 }, job)).not.toEqual([])
    const req = schemaOf('#/components/schemas/JobRequest')
    expect(validate({ type: 'plan', inputs: { ...PLAN_INPUTS_OFFICIAL, pad: 'x' } }, req)).not.toEqual([])
    expect(validate({ type: 'plan' }, req)).not.toEqual([])
  })
  it('contract version is the frozen 1.0.1', () => {
    expect((openapi as { info: { version: string } }).info.version).toBe('1.0.1')
  })
})

describe('every mock response validates against openapi.yaml', () => {
  it('health fixtures (GET /health 200)', () => {
    const s = responseSchema('GET', '/health', 200)
    for (const h of [HEALTH_WARM, HEALTH_COLD, HEALTH_NOT_OK]) valid(h, s)
  })
  it('job scripts (POST /jobs 202, GET /jobs/{id} 200)', () => {
    const post = responseSchema('POST', '/jobs', 202)
    const get = responseSchema('GET', '/jobs/{id}', 200)
    for (const script of [jobScript(), failedJobScript()]) {
      valid(script[0], post)
      for (const j of script.slice(1)) valid(j, get)
    }
  })
  it('run record (GET /results/{hash}/provenance 200)', () => {
    valid(RUN_RECORD_LIVE, responseSchema('GET', '/results/{hash}/provenance', 200))
  })
  it('error answers of the mock (404, 429, 503) are Error documents', () => {
    const err = schemaOf('#/components/schemas/Error')
    valid({ error: 'not_found', detail: '/x' }, err)
    valid({ error: 'rate_limited', retry_after_s: 42 }, responseSchema('POST', '/jobs', 429))
    valid({ error: 'unavailable' }, err)
  })

  it('live mock answers over HTTP, and the client request bodies, validate', async () => {
    const fetch = createMockFetch()
    const client = createApiClient({ base: 'http://api.test', fetch })
    valid(await client.health(), responseSchema('GET', '/health', 200))
    const req = { type: 'plan' as const, inputs: PLAN_INPUTS_OFFICIAL }
    const job = await client.submitJob(req)
    valid(job, responseSchema('POST', '/jobs', 202))
    valid(await client.getJob(job.id), responseSchema('GET', '/jobs/{id}', 200))
    // request body: JobRequest (with the plan_inputs contract inlined)
    valid(fetch.calls[1].body, schemaOf('#/components/schemas/JobRequest'))
    // unknown paths answer an Error 404
    await expect(client.engineVersion()).rejects.toMatchObject({ status: 404, code: 'not_found' })
  })
})

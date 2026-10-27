#!/usr/bin/env node
/**
 * Builds the public openapi.json from the internal KryptaPay API spec.
 *
 *   npm run openapi                       # from http://localhost:4000/docs/json
 *   npm run openapi -- path/to/spec.json  # from a saved spec (or another URL)
 *   npm run openapi -- --check            # exit 1 if openapi.json is out of date
 *
 * Only operations allowlisted in openapi.config.mjs are published.
 */
import { readFile, writeFile } from 'node:fs/promises'
import * as cfg from './openapi.config.mjs'

const DEFAULT_SOURCE = 'http://localhost:4000/docs/json'
const OUT = new URL('../openapi.json', import.meta.url)
const METHODS = ['get', 'post', 'put', 'patch', 'delete']

const args = process.argv.slice(2)
const check = args.includes('--check')
const source = args.find((a) => !a.startsWith('--')) ?? DEFAULT_SOURCE

const errors = []
const fail = (msg) => errors.push(msg)
const clone = (v) => structuredClone(v)
const sameEnum = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i])

async function load(src) {
  if (/^https?:\/\//.test(src)) {
    const res = await fetch(src)
    if (!res.ok) throw new Error(`GET ${src} → ${res.status}`)
    return res.json()
  }
  return JSON.parse(await readFile(src, 'utf8'))
}

// ─── Schema helpers ──────────────────────────────────────────────────────

const jsonOf = (holder) => holder?.content?.['application/json']
const successCode = (op) => Object.keys(op.responses ?? {}).find((c) => c.startsWith('2'))
const responseData = (op) => jsonOf(op.responses?.[successCode(op)])?.schema?.properties?.data

/** Calls fn on every schema node reachable from `schema`. */
function walk(schema, fn) {
  if (!schema || typeof schema !== 'object') return
  fn(schema)
  for (const child of Object.values(schema.properties ?? {})) walk(child, fn)
  if (schema.items) walk(schema.items, fn)
  if (schema.additionalProperties && typeof schema.additionalProperties === 'object') walk(schema.additionalProperties, fn)
  for (const k of ['anyOf', 'oneOf', 'allOf']) for (const child of schema[k] ?? []) walk(child, fn)
}

/** Resolves "a.b.c" below `root`, descending through array items and anyOf variants. */
function resolve(root, dotted) {
  let node = root
  for (const key of dotted.split('.')) {
    const candidates = [node, node?.items, ...(node?.anyOf ?? [])]
    node = candidates.map((c) => c?.properties?.[key]).find(Boolean)
    if (!node) return undefined
  }
  return node
}

function removeProperties(schema, names) {
  walk(schema, (s) => {
    if (!s.properties) return
    for (const n of names) delete s.properties[n]
    if (s.required) s.required = s.required.filter((r) => !names.includes(r))
  })
}

/** OpenAPI 3.0 `nullable: true` → 3.1 `type: [t, "null"]`. */
function fixNullable(schema) {
  walk(schema, (s) => {
    if (s.nullable !== true) return
    delete s.nullable
    if (typeof s.type === 'string') s.type = [s.type, 'null']
  })
}

function hoistEnums(schema, enums) {
  walk(schema, (s) => {
    for (const [name, values] of Object.entries(enums)) {
      if (!sameEnum(s.enum, values)) continue
      delete s.enum
      delete s.type
      s.$ref = `#/components/schemas/${name}`
      return
    }
  })
}

// ─── Shared components ───────────────────────────────────────────────────

const errorSchema = {
  type: 'object',
  properties: {
    ok: { type: 'boolean', enum: [false] },
    error: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Stable, machine-readable code. Branch on this, not on `message`.' },
        message: { type: 'string', description: 'Human-readable explanation. May change; do not parse.' },
        details: { description: 'Extra context. For `validation_error`: `{ formErrors, fieldErrors }`.' },
      },
      required: ['code', 'message'],
    },
  },
  required: ['ok', 'error'],
}

const errorResponses = {
  401: ['Unauthorized', 'Missing, invalid or expired API key.', 'unauthorized', 'Invalid or expired API key'],
  403: ['Forbidden', 'The key lacks the required scope (`insufficient_scope`), or the account is not KYB-approved (`kyb_required`).', 'kyb_required', 'Your organization must complete KYB verification.'],
  404: ['NotFound', 'The resource does not exist or belongs to another account.', 'not_found', 'Payout not found'],
  409: ['Conflict', 'The resource is not in a state that allows this action.', 'bad_status', 'Cannot cancel in status PROCESSING'],
  422: ['ValidationError', 'The request failed validation or a business rule. See `error.code` and, for `validation_error`, `error.details.fieldErrors`.', 'validation_error', 'amount: Invalid amount'],
  502: ['UpstreamUnavailable', 'The payment operator could not process the request. Retry with backoff or use another network.', 'payin_unavailable', 'Le paiement Mobile Money est momentanément indisponible.'],
  429: ['RateLimited', 'Too many requests. Wait for the number of seconds in the `retry-after` header.', 'rate_limited', 'Rate limit exceeded, retry in 1 minute'],
}

function buildComponents(enums) {
  const schemas = { Error: errorSchema }
  for (const [name, def] of Object.entries(cfg.sharedEnums)) {
    schemas[name] = { type: 'string', enum: enums[name], description: def.description }
  }
  Object.assign(schemas, cfg.extraSchemas)

  const responses = {}
  for (const [, [name, description, code, message]] of Object.entries(errorResponses)) {
    responses[name] = {
      description,
      content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' }, example: { ok: false, error: { code, message } } } },
    }
  }

  return {
    securitySchemes: {
      apiKey: {
        type: 'http',
        scheme: 'bearer',
        description: 'Secret API key from **Dashboard → Developers**: `kp_sandbox_…` for Sandbox, `kp_live_…` for Production. Server-side only.',
      },
    },
    parameters: {
      IdempotencyKey: {
        name: 'Idempotency-Key',
        in: 'header',
        required: false,
        description: 'Unique key (a UUID is ideal) for this operation. Retrying with the same key returns the original result instead of creating a duplicate.',
        schema: { type: 'string', maxLength: 128 },
      },
    },
    responses,
    schemas,
  }
}

// ─── Operation transform ─────────────────────────────────────────────────

function transformOperation(key, internalOp, opCfg, enums) {
  const op = clone(internalOp)
  const auth = opCfg.auth ?? 'apiKey'

  // Request body
  const body = jsonOf(op.requestBody)
  if (body?.schema) {
    removeProperties(body.schema, cfg.stripRequestProperties)
    if (opCfg.requestExample) body.example = opCfg.requestExample
  }
  for (const [path, names] of Object.entries(opCfg.required ?? {})) {
    const [, dotted] = path.split(':')
    const target = dotted ? resolve(body?.schema, dotted) : body?.schema
    const missing = names.filter((n) => !target?.properties?.[n])
    if (!target || missing.length) fail(`${key}: required "${path}" → ${missing.join(', ') || 'schema not found'}`)
    else target.required = [...new Set([...(target.required ?? []), ...names])]
  }

  // Success response
  const code = successCode(op)
  if (opCfg.response) {
    op.responses[code ?? '200'] = { description: 'Success', content: { 'application/json': { schema: clone(opCfg.response) } } }
  }
  const success = op.responses[successCode(op)]
  if (success.description === 'Default Response') success.description = 'Success'
  if (opCfg.dropResponse) {
    const data = responseData(op)
    removeProperties(data, opCfg.dropResponse)
    if (data?.properties?.items) removeProperties(data.properties.items, opCfg.dropResponse)
  }
  if (opCfg.responseExample && jsonOf(success)) jsonOf(success).example = opCfg.responseExample

  // Parameters: drop the internal idempotency header, add the shared one where honoured
  op.parameters = (op.parameters ?? []).filter(
    (p) => p.name.toLowerCase() !== 'idempotency-key' && !(opCfg.dropParams ?? []).includes(p.name),
  )
  if (opCfg.idempotent) op.parameters.push({ $ref: '#/components/parameters/IdempotencyKey' })

  // Field descriptions
  for (const [path, description] of Object.entries(opCfg.fields ?? {})) {
    const [where, dotted] = path.split(':')
    const target =
      where === 'param' ? op.parameters.find((p) => p.name === dotted)
      : where === 'request' ? resolve(body?.schema, dotted)
      : where === 'response' ? resolve(responseData(op), dotted)
      : undefined
    if (!target) fail(`${key}: field "${path}" not found`)
    else target.description = description
  }

  // Strip internal fields, modernise nullables, hoist shared enums everywhere
  const schemas = [body?.schema, ...op.parameters.map((p) => p.schema), ...Object.values(op.responses).map((r) => jsonOf(r)?.schema)]
  for (const s of schemas.filter(Boolean)) {
    removeProperties(s, cfg.stripProperties)
    fixNullable(s)
    hoistEnums(s, enums)
  }

  // Errors: replace internal error responses with the shared ones
  for (const c of Object.keys(op.responses)) if (!c.startsWith('2')) delete op.responses[c]
  const codes = [...(auth === 'apiKey' ? [401, 403] : []), ...(opCfg.errors ?? []), 429].sort()
  for (const c of new Set(codes)) {
    if (!errorResponses[c]) fail(`${key}: no shared error response for ${c}`)
    else op.responses[c] = { $ref: `#/components/responses/${errorResponses[c][0]}` }
  }

  const description = [opCfg.description, opCfg.scope && `**API key scope:** \`${opCfg.scope}\``].filter(Boolean).join('\n\n')
  return {
    operationId: opCfg.operationId,
    summary: opCfg.summary,
    ...(description && { description }),
    tags: [opCfg.tag],
    ...(auth === 'none' && { security: [] }),
    ...(op.parameters.length && { parameters: op.parameters }),
    ...(op.requestBody && { requestBody: op.requestBody }),
    responses: op.responses,
  }
}

// ─── Main ────────────────────────────────────────────────────────────────

const internal = await load(source)
const findOp = (key) => {
  const [method, path] = key.split(' ')
  return internal.paths?.[path]?.[method.toLowerCase()]
}

// Shared enum values come from the internal spec, so new networks/currencies flow through.
const enums = {}
for (const [name, def] of Object.entries(cfg.sharedEnums)) {
  const op = findOp(def.from)
  const [where, dotted] = def.at.split(':')
  const node = op && resolve(where === 'request' ? jsonOf(op.requestBody)?.schema : responseData(op), dotted)
  if (!node?.enum) fail(`sharedEnums.${name}: no enum at ${def.from} ${def.at}`)
  else enums[name] = node.enum
}

const paths = {}
for (const [key, opCfg] of Object.entries(cfg.operations)) {
  const internalOp = findOp(key)
  if (!internalOp) { fail(`${key}: not found in the internal spec`); continue }
  const [method, path] = key.split(' ')
  const publicPath = path.length > 1 ? path.replace(/\/$/, '') : path
  ;(paths[publicPath] ??= {})[method.toLowerCase()] = transformOperation(key, internalOp, opCfg, enums)
}

if (errors.length) {
  console.error(`✖ ${errors.length} problem(s):\n  - ${errors.join('\n  - ')}`)
  process.exit(1)
}

const spec = {
  openapi: '3.1.0',
  info: cfg.info,
  servers: cfg.servers,
  security: [{ apiKey: [] }],
  tags: cfg.tags,
  paths,
  components: buildComponents(enums),
}
const output = JSON.stringify(spec, null, 2) + '\n'

const opCount = Object.values(paths).reduce((n, p) => n + Object.keys(p).filter((m) => METHODS.includes(m)).length, 0)
if (check) {
  const current = await readFile(OUT, 'utf8').catch(() => '')
  if (current !== output) {
    console.error('✖ openapi.json is out of date — run `npm run openapi`.')
    process.exit(1)
  }
  console.log(`✓ openapi.json is up to date (${opCount} operations).`)
} else {
  await writeFile(OUT, output)
  console.log(`✓ Wrote openapi.json — ${opCount} public operations from ${source}`)
}

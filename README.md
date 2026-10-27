# KryptaPay API docs

Public developer documentation for the KryptaPay API, built with [Mintlify](https://mintlify.com). Pushing to `main` deploys it.

## Layout

| Path | Content |
| --- | --- |
| `*.mdx` | Guides (quickstart, authentication, payins, payouts, webhooks…) |
| `api-reference/` | API reference pages: one stub per endpoint (`openapi: METHOD /path`) plus the introduction |
| `openapi.json` | Public OpenAPI spec — **generated, do not edit by hand** |
| `scripts/openapi.config.mjs` | Which endpoints are public, plus their descriptions and examples |
| `scripts/build-openapi.mjs` | Generator: internal spec → public `openapi.json` |
| `docs.json` | Navigation, theme and redirects |

## Preview locally

```bash
npm i -g mint
mint dev            # http://localhost:3000
mint broken-links   # check internal links
```

## Updating the API reference

`openapi.json` is generated from the internal spec served by `kryptapay-api` at `/docs/json`. Only operations allowlisted in `scripts/openapi.config.mjs` are published; internal fields (provider details, dashboard-only fields) are stripped.

```bash
# kryptapay-api running locally on :4000
npm run openapi

# or from a saved spec / another environment
npm run openapi -- ./internal-openapi.json

# CI: fail if openapi.json is stale
npm run openapi:check
```

### Publishing a new endpoint

1. Add it to `operations` in `scripts/openapi.config.mjs` (tag, `operationId`, summary, description, examples).
2. Run `npm run openapi`.
3. Add a stub page in `api-reference/<group>/<name>.mdx`:
   ```mdx
   ---
   openapi: "GET /v1/example"
   ---
   ```
4. Add the page to the **API reference** tab in `docs.json`.

The script fails if an allowlisted operation or field no longer exists in the internal spec, so renames in the API are caught instead of silently dropped.

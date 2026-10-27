# Documentation project instructions

## About this project

- Public developer docs for the KryptaPay API, built on [Mintlify](https://mintlify.com).
- Pages are MDX files with YAML frontmatter; navigation, theme and redirects live in `docs.json`.
- `openapi.json` is **generated** by `npm run openapi` from the kryptapay-api internal spec. Never edit it by hand: change `scripts/openapi.config.mjs` and regenerate. See `README.md`.

## Terminology

- "Payin" (collecting money) and "payout" (sending money) — not "deposit" or "withdrawal".
- "Network" for a Mobile Money operator, bank rail or chain code (`MTN_BJ`, `BANK_EUR`, `TRON`). Don't name the payment aggregators KryptaPay routes through.
- "Sandbox" and "Production" for environments; keys are `kp_sandbox_…` and `kp_live_…`.
- Sandbox base URL: `https://staging.api.krypta-pay.com`. Production: `https://api.krypta-pay.com`.

## Style preferences

- English only.
- Use active voice and second person ("you").
- Keep sentences concise — one idea per sentence.
- Use sentence case for headings. No `# H1` in pages: the frontmatter `title` is the H1.
- Bold for UI elements: **Developers → API keys**.
- Code formatting for fields, codes, headers, paths and commands.
- Amounts in examples are decimal strings (`"5000"`), references look like `tx_…`.

## Content boundaries

- Document only what an API-key integration can use. Dashboard-only, admin and internal routes stay out.
- Don't expose provider/aggregator names, `providerRef`, routing flags or internal infrastructure.
- Every behavior stated must match kryptapay-api. Check the route code before documenting a status code, error code or limit.

/**
 * What the public API reference exposes, and how it is presented.
 *
 * build-openapi.mjs reads the internal spec (kryptapay-api /docs/json) and keeps
 * ONLY the operations listed in `operations` below. A new internal route never
 * reaches the public docs until someone adds it here.
 */

export const info = {
  title: 'KryptaPay API',
  version: '1.0.0',
  description: [
    'Collect and pay out across Africa — Mobile Money, bank transfers and stablecoins — through one REST API.',
    '',
    'Authenticate every request with your secret API key: `Authorization: Bearer kp_<env>_…`.',
    'All responses use the envelope `{ "ok": boolean, "data"?: …, "error"?: { "code", "message", "details"? } }`.',
  ].join('\n'),
  contact: { name: 'KryptaPay Support', email: 'support@krypta-pay.com', url: 'https://krypta-pay.com' },
}

export const servers = [
  { url: 'https://staging.api.krypta-pay.com', description: 'Sandbox' },
  { url: 'https://api.krypta-pay.com', description: 'Production' },
]

// Display order of the API Reference sidebar.
export const tags = [
  { name: 'Payins', description: 'Collect money from your customers\' Mobile Money wallets.' },
  { name: 'Payouts', description: 'Send money to Mobile Money wallets, bank accounts and crypto addresses.' },
  { name: 'Fees', description: 'Know the exact fee before you move money.' },
  { name: 'FX', description: 'Exchange rates, quotes and conversions between your wallets.' },
  { name: 'Wallets', description: 'Balances of your multi-currency wallets.' },
  { name: 'Transactions', description: 'Unified history of every movement on your account.' },
  { name: 'Networks', description: 'Which payment networks are currently available.' },
  { name: 'Status', description: 'Public platform status.' },
]

// Fields removed from every schema: internal routing details integrators must not depend on.
export const stripProperties = ['provider', 'providerRef', 'providerFee', 'providerMode', 'upstreamMode']

// Request-body fields that only make sense from the dashboard (user 2FA, internal links).
export const stripRequestProperties = ['paymentPin', 'totp', 'invoiceId', 'conversionId', 'counterpartyId']

// Enums hoisted into components.schemas when an inline enum matches exactly.
export const sharedEnums = {
  Currency: { from: 'POST /v1/payouts/', at: 'request:currency', description: 'ISO currency code (fiat) or stablecoin ticker.' },
  Network: { from: 'POST /v1/payouts/', at: 'request:network', description: 'Payment network. See [Networks & currencies](/networks) for countries and limits.' },
  TransactionStatus: { from: 'GET /v1/payins/{reference}', at: 'response:status', description: 'Lifecycle status. `COMPLETED`, `FAILED`, `CANCELLED` and `REFUNDED` are final.' },
}

// Hand-written schemas for routes the internal spec doesn't describe.
export const extraSchemas = {
  SupportedNetwork: {
    type: 'object',
    properties: {
      code: { $ref: '#/components/schemas/Network' },
      currency: { $ref: '#/components/schemas/Currency' },
      country: { type: 'string', description: 'ISO 3166-1 alpha-2 country code.' },
    },
    required: ['code', 'currency', 'country'],
  },
}

const MSISDN_DESC = 'MSISDN, local or international format (digits only or with a leading "+"), e.g. "97000000", "22997000000", or "+22997000000".'

const payoutExample = {
  id: 'cmgx2k1qv0001s60f8h3n5z7a',
  reference: 'tx_V1StGXR8Z5jdHi6BmyT',
  status: 'PROCESSING',
  amount: '15000',
  currency: 'XOF',
  fee: '150',
  network: 'MTN_BJ',
  description: 'Supplier payment #1042',
  recipient: { msisdn: '22997000000' },
  failureReason: null,
  initiatedAt: '2026-10-27T10:15:00.000Z',
  settledAt: null,
  failedAt: null,
  idempotencyKey: '4b17ddc6-4d7f-4d3e-a7d5-62e3c7f2d18d',
  approvedAt: '2026-10-27T10:15:00.000Z',
  autoExecuted: true,
  frozen: false,
}

const walletExample = {
  id: 'cmgx2k1qv0002s60f1a9b8c7d',
  kind: 'FIAT',
  currency: 'XOF',
  label: 'XOF wallet',
  balance: '1250000',
  reserved: '15150',
  available: '1234850',
  chain: null,
  address: null,
  byCountry: [{ country: 'BJ', amount: '1250000' }],
}

const transactionExample = {
  id: 'cmgx2k1qv0001s60f8h3n5z7a',
  reference: 'tx_V1StGXR8Z5jdHi6BmyT',
  type: 'PAYOUT',
  direction: 'OUTGOING',
  status: 'COMPLETED',
  amount: '15000',
  currency: 'XOF',
  fee: '150',
  grossAmount: '15150',
  network: 'MTN_BJ',
  description: 'Supplier payment #1042',
  category: 'suppliers',
  initiatedAt: '2026-10-27T10:15:00.000Z',
  settledAt: '2026-10-27T10:15:42.000Z',
  failedAt: null,
  failureReason: null,
}

/**
 * Public operations, keyed "METHOD /internal/path" exactly as in the internal spec.
 *  - auth:       'apiKey' (default) or 'none'
 *  - scope:      API key scope a write needs (reads accept any valid key)
 *  - idempotent: documents the Idempotency-Key header (only routes that honour it)
 *  - errors:   extra error statuses beyond the defaults (401/403/429 for apiKey ops)
 *  - fields:   { 'request:a.b' | 'response:a.b' | 'param:name': description }
 *  - required: { 'request' | 'request:a.b': [...] } fields to mark required (added to the internal list)
 *  - dropParams / dropResponse: query params / response fields to hide
 */
export const operations = {
  // ── Payins ────────────────────────────────────────────────────────────
  'POST /v1/payins/checkout': {
    tag: 'Payins',
    operationId: 'createPayin',
    summary: 'Create a payin',
    description: [
      'Charges a customer\'s Mobile Money wallet directly. Depending on the operator, the response tells you what the customer must do next:',
      '',
      '- **Phone prompt** (most operators) — `checkoutUrl` is `null`; the customer approves on their phone with their PIN.',
      '- **Operator redirect** (e.g. Wave, Djamo, Orange Money Senegal) — redirect the customer to `checkoutUrl`; they come back to your `redirectUrl`.',
      '- **Code** (Orange Money Côte d\'Ivoire and Burkina Faso) — `otpRequired` is true: show `otpInstructions` and send the code to [Confirm a payin with a code](/api-reference/payins/confirm-otp).',
      '',
      'The payin starts as `PENDING`; listen for the `PAYIN_RECEIVED` / `PAYIN_FAILED` webhooks or poll [Get a payin](/api-reference/payins/get).',
      '',
      'In sandbox the payin is simulated and returns `COMPLETED` immediately.',
    ].join('\n'),
    scope: 'payins:write',
    errors: [422, 502],
    required: { 'request': ['network'], 'request:customer': ['msisdn'] },
    fields: {
      'request:customer.msisdn': `${MSISDN_DESC} The wallet that will be charged.`,
      'request:network': 'Mobile Money network to charge. Must match `currency`.',
      'request:redirectUrl': 'Where the operator sends the customer back after an operator redirect (`checkoutUrl`).',
      'request:expiresInSec': 'How long the customer has to approve the payment, in seconds (60 to 86400).',
      'response:checkoutUrl': 'Operator page to redirect the customer to, for operators that need it. `null` when the customer approves on their phone.',
      'response:otpRequired': 'True when the operator needs a one-time code from the customer to confirm the payment.',
      'response:otpInstructions': 'Text to show the customer explaining how to obtain the code.',
    },
    dropResponse: ['checkoutToken'],
    requestExample: {
      amount: '5000',
      currency: 'XOF',
      network: 'MTN_BJ',
      customer: { fullName: 'Awa Koné', msisdn: '22997000000', email: 'awa@example.com' },
      redirectUrl: 'https://example.com/orders/1042',
      expiresInSec: 900,
    },
    responseExample: {
      ok: true,
      data: {
        reference: 'tx_3Jk9QwErTy7uIoPa2Sd',
        status: 'PENDING',
        amount: '5000',
        currency: 'XOF',
        checkoutUrl: null,
        expiresInSec: 900,
        otpRequired: false,
        otpInstructions: null,
      },
    },
  },
  'POST /v1/payins/{reference}/confirm-otp': {
    tag: 'Payins',
    operationId: 'confirmPayinOtp',
    summary: 'Confirm a payin with a code',
    description: [
      'Completes a payin whose creation returned `otpRequired: true` (e.g. Orange Money Côte d\'Ivoire and Burkina Faso).',
      'Show the customer `otpInstructions`, collect the code they generate on their phone, then send it here.',
      '',
      'On success the payin moves to `PROCESSING`; the final result arrives by webhook. Errors: `bad_status` (payin no longer `PENDING`), `otp_unsupported` (this payin doesn\'t use a code), `otp_failed` (wrong code or refused by the operator — let the customer generate a new code and retry).',
    ].join('\n'),
    scope: 'payins:write',
    errors: [404, 422],
    fields: {
      'param:reference': 'Payin reference (`tx_…`) or id.',
      'request:otp': 'Code generated by the customer, as they typed it.',
    },
    requestExample: { otp: '482913' },
    responseExample: { ok: true, data: { reference: 'tx_3Jk9QwErTy7uIoPa2Sd', status: 'PROCESSING' } },
  },
  'GET /v1/payins/{reference}': {
    tag: 'Payins',
    operationId: 'getPayin',
    summary: 'Get a payin',
    description: 'Returns the current status of a payin, by `reference` (`tx_…`) or id. Use it to confirm a webhook before fulfilling an order.',
    errors: [404],
    responseExample: {
      ok: true,
      data: {
        reference: 'tx_3Jk9QwErTy7uIoPa2Sd',
        status: 'COMPLETED',
        amount: '5000',
        currency: 'XOF',
        network: 'MTN_BJ',
        checkoutUrl: null,
        expiresAt: '2026-10-27T10:30:00.000Z',
        initiatedAt: '2026-10-27T10:15:00.000Z',
        settledAt: '2026-10-27T10:16:05.000Z',
      },
    },
  },

  // ── Payouts ───────────────────────────────────────────────────────────
  'POST /v1/payouts/': {
    tag: 'Payouts',
    operationId: 'createPayout',
    summary: 'Create a payout',
    description: [
      'Sends money from your wallet in `currency` to a recipient. The amount plus fee is reserved immediately.',
      '',
      'Always send an `Idempotency-Key`: retrying with the same key returns the original payout instead of paying twice.',
      'Listen for the `PAYOUT_COMPLETED` / `PAYOUT_FAILED` webhooks for the final result.',
    ].join('\n'),
    scope: 'payouts:write',
    idempotent: true,
    errors: [409, 422],
    fields: {
      'request:recipient': 'Which fields are required depends on `network`: mobile money networks require msisdn; BANK_NGN requires accountNumber and bankCode; crypto networks (ETH/POLYGON/TRON) require address. Every other bank rail (BANK_XOF, BANK_XAF, BANK_GHS, BANK_CDF, BANK_EUR, BANK_USD) is settled manually by KryptaPay today, so at least one recipient identifier is required but no specific field is enforced yet.',
      'request:recipient.msisdn': `${MSISDN_DESC} Required for mobile money networks.`,
      'request:recipient.bankName': 'Informational only today — no payment provider reads this field. Kept for display / forward-compatibility.',
      'request:recipient.bankId': 'Informational only today — no payment provider reads this field. Use bankCode instead.',
      'request:recipient.bankCode': "Bank code identifying the recipient's bank. Required for BANK_NGN (along with accountNumber) — this is the field payment providers actually read for Nigerian bank transfers.",
      'request:recipient.accountNumber': 'Recipient bank account number (e.g. Nigerian NUBAN). Required for BANK_NGN, along with bankCode.',
      'request:recipient.customerId': 'Your own identifier for this recipient.',
      'request:category': 'Free-form label for your reporting (e.g. `salaries`, `suppliers`).',
      'response:frozen': 'True when the payout is on hold for compliance review. It stays PENDING until cleared; do not resubmit it.',
      'response:autoExecuted': 'True when the payout was sent without manual approval.',
    },
    requestExample: {
      amount: '15000',
      currency: 'XOF',
      network: 'MTN_BJ',
      recipient: { msisdn: '22997000000', fullName: 'Koffi Mensah' },
      description: 'Supplier payment #1042',
      category: 'suppliers',
    },
    responseExample: { ok: true, data: payoutExample },
  },
  'GET /v1/payouts/': {
    tag: 'Payouts',
    operationId: 'listPayouts',
    summary: 'List payouts',
    description: 'Most recent first. Pass `nextCursor` from the previous page as `cursor` to get the next one; `nextCursor` is `null` on the last page.',
    responseExample: { ok: true, data: { items: [payoutExample], nextCursor: null } },
  },
  'GET /v1/payouts/{id}': {
    tag: 'Payouts',
    operationId: 'getPayout',
    summary: 'Get a payout',
    description: 'Retrieve a payout by id or by `reference` (`tx_…`).',
    errors: [404],
    fields: { 'param:id': 'Payout id or reference.' },
    responseExample: { ok: true, data: { ...payoutExample, status: 'COMPLETED', settledAt: '2026-10-27T10:15:42.000Z' } },
  },
  'POST /v1/payouts/{id}/cancel': {
    tag: 'Payouts',
    operationId: 'cancelPayout',
    summary: 'Cancel a payout',
    description: 'Cancels a payout that is still `PENDING` and releases the reserved funds. Returns `409` once the payout is processing or final.',
    scope: 'payouts:write',
    errors: [404, 409],
    fields: { 'param:id': 'Payout id or reference.' },
    responseExample: { ok: true, data: { ...payoutExample, status: 'CANCELLED' } },
  },

  // ── Fees ──────────────────────────────────────────────────────────────
  'GET /v1/fees/quote': {
    tag: 'Fees',
    operationId: 'quoteFee',
    summary: 'Quote a fee',
    description: 'Returns the fee for a payin or payout before you create it, and for payouts the maximum you can send with your current balance.',
    errors: [422],
    fields: {
      'response:networkFee': 'Fee charged for this operation.',
      'response:totalDebit': 'Payout: amount + fee debited from your wallet.',
      'response:netCredited': 'Payin: amount credited to your wallet after fee.',
      'response:available': 'Your current available balance in this currency.',
      'response:maxSendable': 'Payout: largest amount you can send right now, fee included.',
    },
    responseExample: {
      ok: true,
      data: {
        direction: 'PAYOUT',
        amount: '15000',
        currency: 'XOF',
        network: 'MTN_BJ',
        networkFee: '150',
        totalDebit: '15150',
        netCredited: null,
        available: '1234850',
        maxSendable: '1222623',
      },
    },
  },

  // ── FX ────────────────────────────────────────────────────────────────
  'GET /v1/fx/rates': {
    tag: 'FX',
    operationId: 'listFxRates',
    summary: 'List exchange rates',
    description: 'Current mid, buy and sell rates for every supported pair. Public — no API key needed.',
    auth: 'none',
  },
  'POST /v1/fx/quote': {
    tag: 'FX',
    operationId: 'quoteFx',
    summary: 'Quote a conversion',
    description: 'Indicative quote, valid until `expiresAt` (60 seconds). With `side: "debit_from"` the `amount` is what leaves your `from` wallet; with `credit_to` it is what lands in your `to` wallet.',
    errors: [404, 422],
    requestExample: { from: 'EUR', to: 'XOF', amount: '1000', side: 'debit_from' },
    responseExample: {
      ok: true,
      data: {
        from: 'EUR', to: 'XOF', fromAmount: '1000', toAmount: '650000',
        midRate: '655.957', appliedRate: '650', spreadBps: 90,
        expiresAt: '2026-10-27T10:16:00.000Z',
      },
    },
  },
  'POST /v1/fx/convert': {
    tag: 'FX',
    operationId: 'convertFx',
    summary: 'Convert between wallets',
    description: [
      'Executes a conversion from your `from` wallet to your `to` wallet at the current rate. Both wallets must exist.',
      '',
      'Send an `Idempotency-Key`: retrying with the same key returns the original conversion (`200`) instead of converting twice.',
    ].join('\n'),
    scope: 'fx:write',
    idempotent: true,
    errors: [422],
    fields: { 'request:reference': 'Your own reference for this conversion. Generated (`tx_…`) when omitted.' },
    requestExample: { from: 'EUR', to: 'XOF', amount: '1000' },
  },

  // ── Wallets & transactions ────────────────────────────────────────────
  'GET /v1/wallets/': {
    tag: 'Wallets',
    operationId: 'listWallets',
    summary: 'List wallets',
    description: '`available` = `balance` − `reserved` (funds held for payouts in progress). Use `available` to decide whether you can pay out.',
    responseExample: { ok: true, data: { items: [walletExample] } },
  },
  'GET /v1/wallets/{id}': {
    tag: 'Wallets',
    operationId: 'getWallet',
    summary: 'Get a wallet',
    errors: [404],
    responseExample: { ok: true, data: walletExample },
  },
  'GET /v1/transactions/': {
    tag: 'Transactions',
    operationId: 'listTransactions',
    summary: 'List transactions',
    description: 'Every payin, payout, conversion, transfer, fee and refund on your account, most recent first. Paginate with `cursor` / `nextCursor`.',
    fields: {
      'param:q': 'Free-text search on reference and description.',
      'param:rail': 'Filter by rail: mobile money, bank or crypto.',
      'param:from': 'Only transactions created at or after this date.',
      'param:to': 'Only transactions created before this date.',
    },
    dropParams: ['page', 'pageSize'],
    dropResponse: ['total', 'page', 'totalPages'],
    responseExample: { ok: true, data: { items: [transactionExample], nextCursor: 'cmgx2k1qv0000s60fzz9y8x7w' } },
  },
  'GET /v1/transactions/{id}': {
    tag: 'Transactions',
    operationId: 'getTransaction',
    summary: 'Get a transaction',
    errors: [404],
    dropResponse: ['hasCertificate', 'fromWalletId', 'toWalletId'],
  },

  // ── Networks & status ─────────────────────────────────────────────────
  'GET /v1/networks/': {
    tag: 'Networks',
    operationId: 'listNetworks',
    summary: 'List available networks',
    description: 'Mobile money networks you can use right now, per direction. A network is usable when it is in `supported` and not in `unavailable` (temporary maintenance).',
    response: {
      type: 'object',
      properties: {
        ok: { type: 'boolean' },
        data: {
          type: 'object',
          properties: {
            supported: {
              type: 'object',
              description: 'Mobile money networks routable per direction.',
              properties: {
                payin: { type: 'array', items: { $ref: '#/components/schemas/SupportedNetwork' } },
                payout: { type: 'array', items: { $ref: '#/components/schemas/SupportedNetwork' } },
              },
            },
            unavailable: {
              type: 'object',
              description: 'Networks temporarily unavailable (maintenance) per direction.',
              properties: {
                payin: { type: 'array', items: { $ref: '#/components/schemas/Network' } },
                payout: { type: 'array', items: { $ref: '#/components/schemas/Network' } },
              },
            },
          },
        },
      },
    },
    responseExample: {
      ok: true,
      data: {
        supported: {
          payin: [{ code: 'MTN_BJ', currency: 'XOF', country: 'BJ' }, { code: 'WAVE_SN', currency: 'XOF', country: 'SN' }],
          payout: [{ code: 'MTN_BJ', currency: 'XOF', country: 'BJ' }],
        },
        unavailable: { payin: [], payout: ['WAVE_SN'] },
      },
    },
  },
  'GET /status/': {
    tag: 'Status',
    operationId: 'getStatus',
    summary: 'Get platform status',
    description: 'Live status of KryptaPay services. Public — no API key needed.',
    auth: 'none',
  },
}

# Civilon Price Check Phase 3 — Public Manual Submission

## Scope and exposure

Phase 3 adds a direct, human-reviewed manual Price Check journey at `/price-check`. It does not add uploads, object storage, automated extraction, AI, automatic pricing conclusions, result pages, accounts, email, CRM integration, or an admin workflow.

`NEXT_PUBLIC_PRICE_CHECK_ENABLED` is a product-exposure gate, not authorization. The route calls `notFound()` and the API returns `404` unless the value is exactly `true`. It defaults to `false` in `.env.example`, is not linked from the homepage or navigation, and is omitted from the sitemap while disabled. The Phase 3 Deploy Preview is the only remote environment in which it is enabled. Global `NEXT_PUBLIC_ALLOW_INDEXING=false` remains authoritative for preview robots and page metadata.

## Route architecture

- `app/price-check/page.tsx`: server-gated page, production-ready metadata, visible breadcrumb, educational content, and three-step client form.
- `components/PriceCheckForm.tsx`: in-memory step state, conditional exchange/AOG/documentation fields, accessible client-side assistance, attribution capture, safe analytics events, API call, and accepted-reference state.
- `app/api/price-check/submit/route.ts`: server-only JSON endpoint with feature gate, body bound, rate limit, honeypot, authoritative validation, lazy database initialization, generic failures, and `no-store` responses.
- `lib/price-check/*`: shared contract, validation, rate limiting, feature exposure, and application submission orchestration.
- `db/price-check/repositories/request-repository.ts`: the focused Phase 2 aggregate transaction. The route never writes tables directly.

Existing `quick-rfq`, AOG form behavior, `requiredBy`, Netlify Forms, and notification configuration are not used or changed.

## Public field contract

The endpoint accepts JSON only. Unknown properties are rejected. The body is limited to 64 KiB.

Required transaction fields:

- `partNumber`
- `quantity`
- `quoteOrPurchased`: `quote | purchased`
- `transactionType`: `outright | exchange | repair | not_sure`
- `conditionCode`: `NE | NS | OH | SV | AR | NOT_SURE`
- `unitPrice`
- `currencyCode`: `AUD | CAD | CHF | EUR | GBP | JPY | USD`
- `aog`

Optional transaction fields are `description`, `aircraftModel`, `coreCharge`, `coreDisposition`, `exchangeFee`, `freight`, `transactionDate`, `warrantyValue`, `warrantyUnit`, `warrantyText`, `documentationCodes`, `documentationOther`, and `notes`. Exchange-only monetary/core fields are discarded for non-exchange submissions. Refundable core is stored separately and no normalized transaction cost is calculated.

Requester fields require `firstName`, `lastName`, `companyName`, `businessEmail`, and `serviceAcknowledged=true`. `phone` is optional unless `aog=true`. `role` and ISO-2 `country` are optional. Marketing consent remains null.

The controlled documentation vocabulary is `FAA_8130_3`, `EASA_FORM_1`, `DUAL_RELEASE`, `OEM_MANUFACTURER_COC`, `MATERIAL_CERTIFICATION`, `REMOVAL_RECORDS`, `TEARDOWN_EVALUATION_REPORT`, `TEST_REPORT`, `OTHER`, and `NOT_SURE`. `OTHER` requires bounded, sanitized explanatory text. No file field or upload control exists.

## Validation and normalization

`validatePriceCheckSubmission()` is the authoritative server validation boundary. It validates required and bounded strings, part-number characters, positive quantity within database precision, fixed-precision non-negative money, exact enums/currency/document codes, real calendar dates, email, phone, the AOG phone rule, note length, privacy acknowledgment, source page, attribution bounds, and absence of unexpected properties.

The Phase 2 domain helpers preserve the trimmed original part number and separately derive the normalized part number. They also normalize email and phone, validate currency, normalize money to two decimals, sanitize URLs to a landing path or referrer origin, strip unsupported campaign characters, and sanitize `OTHER` documentation text. The implementation does not infer supersession or interchangeability.

## Atomic request creation

The application calls the approved `createPriceCheckRequest()` repository. One database transaction creates:

1. requester;
2. price check;
3. selected document requirements;
4. initial immutable revision; and
5. initial audit event.

Any late constraint or write failure rolls the entire aggregate back and no reference is returned. Postgres integration tests deliberately trigger a late duplicate-document failure and verify zero requester, price-check, revision, and audit rows remain.

Phase 3 adds a small migration that makes requester phone, normalized phone, and country nullable, matching the approved public contract. It does not create or migrate any production table. The schema remains 19 tables.

## Public reference and idempotency

The browser generates a random UUID idempotency key only when a valid final submission is attempted. The server hashes it with a versioned SHA-256 namespace before persistence; the raw key is not stored. A safe network retry returns the existing accepted `PC-XXXXXXXXXX` reference and creates no duplicate aggregate.

The HTTP/application service supplies the existing 10-character Crockford-style public reference generator to the repository. A public-reference unique collision retries up to five times. An idempotency unique race re-reads and returns the already accepted reference. Database IDs, requester IDs, hashes, correlation IDs, stack traces, SQL details, and constraint errors are never returned.

## Abuse protection

Phase 3 applies:

- 64 KiB declared and measured request-body limits;
- JSON-only submissions;
- exact field allowlisting and server validation;
- an off-screen honeypot excluded from keyboard navigation;
- a five-attempt rolling ten-minute limit keyed by a one-way SHA-256 hash of the Netlify/client-forwarded address; and
- idempotent aggregate creation.

The initial rate limiter is intentionally low-friction and process-local. Serverless instances do not share its memory, and restarts clear it. It reduces accidental bursts but is not a durable distributed abuse-control service. A shared edge/KV limiter can replace it if real traffic shows the need; intrusive CAPTCHA is deferred.

## Attribution and analytics boundary

The browser captures only `source_page`, the first-party landing origin/path, referrer input for server reduction to origin, and the five named UTM values. It never copies an arbitrary query string. Server sanitization is repeated before persistence.

The existing analytics wrapper can emit only:

- `price_check_started`
- `price_check_transaction_completed`
- `price_check_contact_completed`
- `price_check_submitted`

Each event contains only `source_page=/price-check`. Part number, transaction values, currency amount, company, email, phone, aircraft data, notes, documentation choices, database IDs, and public reference are excluded.

## Customer response and failures

New submissions return `201` with `{ "ok": true, "reference": "PC-XXXXXXXXXX" }`. Idempotent retries return the same body with `200`. Understandable validation errors return `400` with a generic summary and field messages. Unsupported media is `415`, oversized bodies are `413`, throttling is `429` with `Retry-After`, and a disabled feature is `404`.

Database initialization and write failures are caught after validation and return only a controlled `503` message. The `/price-check` page itself still renders when the database is unavailable. Existing public routes never import or require the Price Check database.

The success state tells the requester to retain the public reference and makes clear that review is human, additional information may be needed, and no transactional email or private result link exists in this phase.

## Preview database and production isolation proof

To be completed from the Draft PR Deploy Preview validation:

- Phase 3 PR and SHA: pending
- Deploy Preview URL and deploy ID: pending
- Isolated preview database branch: pending
- Preview migration result/table count: pending
- Synthetic cases and accepted references: pending
- Synthetic row cleanup decision/result: pending

The production database must remain at zero public tables before and after remote tests. The Phase 3 branch must never be merged or deployed to production during owner review.

## Deferred capabilities

Uploads and scanning, object storage, extraction, OpenAI/AI processing, automated analysis, market ranges, reviewer/admin UI, authentication, transactional email, result tokens/pages, sourcing conversion, customer accounts, CRM, FX conversion, durable distributed rate limiting, and permanent commercial/legal copy are explicitly deferred.

The visible privacy/service copy is implementation copy pending final legal counsel approval. “Free for launch” is localized to launch positioning rather than embedded as a permanent service commitment.

## Cleanup and rollback

For an unapproved Phase 3:

1. keep `NEXT_PUBLIC_PRICE_CHECK_ENABLED` false/unset outside the Phase 3 preview;
2. close the Draft PR without merging;
3. delete the Phase 3 Git branch after evidence is retained;
4. delete only the Phase 3 preview database branch/deploys when their review lifecycle permits;
5. remove synthetic preview rows or the isolated branch; and
6. confirm the planning branch, frozen release branch, production site, and production database remain unchanged.

No DNS, custom domain, indexing, production deployment, production migration, Google Workspace, Netlify Forms, or notification rollback is involved.

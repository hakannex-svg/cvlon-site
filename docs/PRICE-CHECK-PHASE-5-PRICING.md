# Civilon Price Check Phase 5 — deterministic comparable pricing

## Scope

Phase 5 is an internal analyst workflow. It turns a reviewed Price Check transaction into a governed set of comparable decisions and an immutable descriptive analysis version. It does not create or deliver a customer result.

The implementation is deliberately deterministic. It contains no OpenAI call, model, prompt, generated explanation, fuzzy part matching, automatic exchange-rate conversion, supplier score, or price-adjustment coefficient.

## Candidate retrieval

Candidate retrieval normalizes the reviewed part number using the existing Civilon normalization policy. Exact normalized part numbers are searched first. Related part numbers are added only when an existing `part_relationships` row connects the reviewed part to the observation part and the relationship has `verification_state = VERIFIED`.

The analyst workspace exposes exact/related, condition, transaction, currency and eligibility filters. Repository filters also support date range, documentation, AOG context, source reliability, verification state and permitted-use state. Filters never create relationships.

An observation is selectable only when:

- its part number is exact or connected by a verified governed relationship;
- `verification_state = VERIFIED`; and
- `permitted_use_state = INTERNAL_ANALYSIS`.

`AGGREGATE_ONLY`, `PENDING` and `PROHIBITED` evidence is not selectable in this row-level analyst workflow. Restricted exact-part observations may remain visible so the analyst can record an explicit exclusion, but the server rejects any attempt to include them.

## Comparable governance

Every candidate in a saved analysis receives an INCLUDE or EXCLUDE decision, a controlled reason code, and an optional bounded note. The server reloads candidates, revalidates observation IDs, checks the relationship path, and rejects unverified or restricted evidence. It does not accept client-supplied low, median or high values.

The submitted customer price remains the subject being evaluated. It is never automatically inserted into `price_observations` or the selected comparable set.

Observation provenance remains one of the existing controlled values:

- `CIVILON_SUPPLIER_QUOTE`
- `CIVILON_PURCHASE`
- `CIVILON_SALE`
- `CUSTOMER_SUPPLIER_QUOTE`
- `CUSTOMER_COMPLETED_PURCHASE`
- `ANALYST_OBSERVATION`
- `LICENSED_MARKET_DATA`
- `OTHER_AUTHORIZED`

Source/customer identities are not displayed in comparable cards. The UI shows only governed provenance, reliability and evidence attributes needed for analysis.

## Calculation rules

Selected compatible observations contribute their unit-price component directly to descriptive calculations. There is no reliability weighting and no hidden adjustment.

For a same-currency evidence set with at least two observations:

- Observed comparable low = minimum selected unit price
- Observed comparable median = deterministic median
- Observed comparable high = maximum selected unit price
- Arithmetic mean = deterministic fixed-precision internal context
- Position = submitted price below, within or above the observed range

The internal calculation also records newest/oldest observation date, evidence age span, submitted-price difference from median and percentage difference from median when the median is greater than zero.

The terms “fair market value,” “appraised value,” “true value” and “market value guarantee” are not used. The approved Phase 5 wording is “Observed comparable indications.” No “significantly above” threshold exists.

## Fixed-precision and median

Money is converted to four-decimal fixed-point integer units and calculated with `BigInt`. JavaScript floating-point arithmetic is not used for monetary range, mean, difference or percentage calculations. Analysis range columns use `numeric(18,4)` so an even median such as the average of `10.00` and `10.01` persists exactly as `10.0050`.

- Odd median: middle sorted value.
- Even median: fixed-precision average of the two middle sorted values.
- Mean and percentage: deterministic half-up division at four decimal places.

The complete deterministic payload is SHA-256 digested and stored with the analysis version.

## Transaction component rules

### Outright

Unit price is the primary comparable price component.

### Exchange

Exchange unit price, core charge, core disposition, exchange fee and freight remain separate. A refundable core is exposure and is not added to purchase price. When a core is explicitly `FORFEITED`, a separate “known economic cost” context may be calculated from unit price, forfeited core, exchange fee and known freight. It is labeled separately and never replaces the unit-price comparable range.

### Repair

Repair evidence remains separate from acquisition transactions. A mixed transaction set produces `TRANSACTION_TYPE_MIXED`; it is not silently normalized.

## Currency restrictions

No FX conversion is performed. A single range requires every included observation to use the reviewed transaction currency. Mixed or foreign-currency selection produces:

- `CURRENCY_MIXED`
- `CURRENCY_NORMALIZATION_REQUIRED`

and prevents low/median/high persistence until incompatible rows are excluded or a later approved FX policy exists.

## Evidence limitations and warnings

- 0 selected: `INSUFFICIENT_DATA`; confidence must be `INSUFFICIENT_DATA`.
- 1 selected: `SINGLE_OBSERVATION`; an internal descriptive value is retained but no market range is represented.
- 2 selected: `LIMITED_EVIDENCE`; a range can be calculated but the limitation remains explicit.

Compatibility warnings are informational and do not change prices:

- `PART_RELATIONSHIP_USED`
- `CONDITION_MIXED`
- `TRANSACTION_TYPE_MIXED`
- `CORE_TERMS_MIXED`
- `DOCUMENTATION_MIXED`
- `WARRANTY_MIXED`
- `AOG_CONTEXT_MIXED`
- `CURRENCY_MIXED`
- `OLD_EVIDENCE`
- `QUANTITY_VARIANCE`

The Phase 5 evidence-age warning is 730 days. It is an analyst attention flag, not a price adjustment or publishability threshold.

## Confidence dimensions and analyst policy

The engine records structured dimensions instead of inventing a numeric confidence score:

- exact and governed-related PN counts;
- selected evidence count;
- newest/oldest dates and age span;
- same-condition, same-transaction and same-currency counts;
- documentation, core and warranty comparability counts;
- source reliability mix; and
- unresolved warnings.

An analyst chooses `HIGH`, `MEDIUM` or `LOW` and must provide a bounded reason. `INSUFFICIENT_DATA` is required automatically for zero evidence. No automatic rule promotes an analysis to HIGH.

## Analysis versioning and status

Saving creates a new `price_check_analyses` row and a complete `price_check_comparables` decision set with immutable observation snapshots. The version stores the reviewed revision, engine/policy versions, inputs, selected/excluded evidence, descriptive calculations, confidence dimensions, warnings, position and deterministic digest.

A re-run never overwrites history. The previous analysis becomes `SUPERSEDED`; `price_checks.current_analysis_id` points to the new version.

`ready_for_analysis → analysis_ready` is rejected unless a persisted analysis exists. An explicitly reviewed zero-evidence analysis may proceed with `INSUFFICIENT_DATA`; Phase 5 still does not generate a customer result.

## Audit and RBAC

The workflow appends controlled events including observation/relationship creation and verification, analysis start, every comparable decision, analysis creation/supersession, confidence selection and analysis-ready marking.

- ANALYST: view, include/exclude, run analysis and create observations; observation governance is forced to pending unless an administrator acts.
- REVIEWER: Phase 5 analysis capabilities; customer result approval remains Phase 6.
- ADMIN: all Phase 5 capabilities, including governed observations and relationships.
- AUDITOR: read-only.

Every mutation requires a Civilon server session, a server-side capability check and strict same-origin validation. Analysis routes use the Price Check path ID as the aggregate authority and reject unrelated observation IDs and cross-request decision sets.

## Synthetic preview evidence

The preview-only seed endpoint runs only when both are true:

- `CONTEXT = deploy-preview`
- `BRANCH = codex/civilon-price-check-phase-5`

It also requires an authenticated ADMIN. It creates fictional `example.com` requests and observations for exact SV ranges, exchange/refundable and forfeited cores, sparse/zero evidence, governed superseded parts, mixed currencies and conditions, old evidence, AOG context, unverified evidence and prohibited-use evidence. It is idempotent for the Phase 5 preview set.

The seed is not a database migration and cannot execute in production. Production remains fail-closed with Price Check disabled and zero Price Check tables.

## Explicitly deferred

- customer result creation, approval, token and public page;
- transactional email or other delivery;
- uploads, object storage and malware scanning;
- OpenAI, AI extraction, classification or explanation;
- automatic FX conversion;
- automatic supplier scoring or weighted averages;
- automatic interchangeability/supersession inference;
- pricing adjustments or condition/AOG/documentation multipliers;
- a “significantly above” threshold;
- customer-facing percentage differences; and
- CRM or public price history.

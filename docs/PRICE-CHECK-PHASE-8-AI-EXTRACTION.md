# Civilon Price Check Phase 8 — governed document extraction

Status: preview-only implementation. Phase 8 is not approved for production customer documents. The full privacy policy is **PENDING COUNSEL REVIEW BEFORE PUBLIC PRODUCTION LAUNCH**.

## Purpose and authority boundary

Phase 8 lets an authorized staff member request structured fact extraction from a clean supporting document. The model proposes document facts; it does not price a part, choose comparables, assess fairness, calculate a margin, approve a result, or create a Price Observation. Civilon's deterministic Phase 5 engine remains the pricing authority and consumes only the original submission or a human-confirmed revision.

## Preview configuration

- Dedicated OpenAI API project: `Civilon Price Check Preview`
- Selected and tested model: `gpt-5.4-mini-2026-03-17`
- API: Responses API
- Request persistence flag: `store: false`
- Schema version: `phase8-v1`
- Prompt version: `phase8-v2`
- Data-minimization policy version: `phase8-minimum-document-only-v1`
- Configuration is server-only and branch-scoped to `codex/civilon-price-check-phase-8`.
- Production has no Phase 8 OpenAI configuration, Price Check remains disabled there, and the production Price Check public schema remains empty.

The model snapshot was selected because it supports Responses API document/image input and strict Structured Outputs while offering a reasonable preview cost and latency profile. Accuracy, exact digit preservation, abstention, and schema reliability are evaluated before cost. The configured model is environment-driven so a future change is explicit and testable rather than embedded in business logic.

## Request architecture

1. An ANALYST, REVIEWER, or ADMIN explicitly requests extraction for an attachment belonging to the current Price Check.
2. The server creates or returns the idempotent `EXTRACTION` processing job. Only ADMIN can request a controlled retry; at most three attempts are allowed.
3. The worker leases the job and rechecks the database attachment state.
4. The worker verifies the S3 `GuardDutyMalwareScanStatus=NO_THREATS_FOUND` tag, retrieves the private object, repeats file-format validation, and compares its exact size and SHA-256 digest with the clean record.
5. The worker sends only the document bytes and extraction instructions to the Responses API. It does not send requester, admin, pricing, comparable, result, or audit data.
6. PDFs use a Base64 `input_file` with high detail. JPEG, PNG, and WebP use a Base64 `input_image` with high detail.
7. The request uses strict JSON Schema and `store: false`, with no tools. No `/v1/files`, Conversations, File Search, Vector Store, web search, MCP, code execution, background mode, or autonomous agent is used.
8. In-memory document bytes are discarded after the request. Only the bounded structured proposal and safe operational metadata are persisted.
9. A human chooses a line item and accepts individual fields. The server loads the stored proposal itself and creates a new immutable `price_check_revisions` version. Browser-supplied extracted values are never trusted.

## Extraction schema

The strict, versioned schema supports at most 25 line items. Every material field records a presence state (`PRESENT`, `NOT_FOUND`, `AMBIGUOUS`, or `CONFLICTING`), a normalized proposal when supported, raw wording, and bounded evidence metadata. Evidence has an optional page number, a short span, a source type (`text`, `visual`, `both`, or `unknown`), and an ambiguity flag.

The schema preserves part-number punctuation and dash numbers, represents money as decimal strings, separates exchange price/core/exchange fee/freight, and restricts condition, transaction, and documentation proposals to approved enums. Unknown fields and malformed numeric values fail validation. Missing or ambiguous evidence is not forced into a value. Prompt version `phase8-v2` additionally requires line-item freight to be supported by an explicit numeric amount tied to that line; document-level “not included” or “quoted separately” terms are not converted to zero.

## Prompt-injection boundary

Document text and images are untrusted evidence. The system instructions require the model not to follow embedded instructions, links, URLs, QR codes, commands, or requests to expose instructions. No tools are available. The model must return only schema fields and must abstain rather than infer unsupported facts. The application validates the strict response again on the server before persistence.

## Persistence, versioning, and audit

- `processing_jobs` provides queue state, leases, bounded retries, duplicate suppression, and manual-fallback state.
- `attachment_extractions` stores immutable, incrementing proposal versions and review/acceptance metadata.
- `ai_artifacts` stores provider/model/config versions, a request digest, schema-validation state, latency, safe token counts, and sanitized failure category.
- Audit entries contain internal IDs and controlled metadata only.
- API keys, authorization headers, Base64 bodies, full document text, requester PII copied from other tables, pricing/comparable data, and signed S3 URLs are never persisted or logged by Phase 8.

Applying selected proposal fields creates a revision linked to its extraction. It never updates the immutable original submission and never inserts `price_observations`.

## RBAC and failure behavior

- ANALYST: view, trigger extraction, confirm selected fields.
- REVIEWER: view, trigger extraction, confirm selected fields.
- ADMIN: the above plus controlled retry.
- AUDITOR: view extraction metadata/proposals only; no trigger or application action.

Origin checks, authenticated exact-email authorization, capability checks, Price Check/attachment ownership, and server-loaded proposals are enforced in the API. Pending, rejected, failed, malformed, replaced, or unverifiably scanned objects fail closed.

Timeout, rate limit, provider failure, refusal, missing output, schema failure, and exhausted attempts produce a categorized failure and the visible message “Extraction unavailable — review the document manually.” Manual revision, deterministic analysis, and result approval remain available.

## OpenAI data-control assumptions

Phase 8 follows the current official API documentation:

- [File inputs](https://developers.openai.com/api/docs/guides/file-inputs)
- [Images and vision](https://developers.openai.com/api/docs/guides/images-vision)
- [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [Data controls](https://developers.openai.com/api/docs/guides/your-data)

The implementation uses `store: false` and standard API data controls. It does not claim that the provider retains nothing, and it does not claim Zero Data Retention, Modified Abuse Monitoring, or organization-level enhanced controls because none was separately verified for this project. API data is treated under the current documented default training and abuse-monitoring rules. Production customer-document processing remains blocked on final privacy/legal disclosure and approval.

The planned full privacy notice must state that uploads are optional; uploaded documents may be processed by third-party automated-processing service providers to identify transaction details; automated extraction does not determine Civilon's pricing analysis; and Civilon staff review extracted information before applying it. Requester identity is not separately added to the model request unless needed. Standard provider retention and data-control rules may apply, Civilon does not claim Zero Data Retention, and document deletion and retention periods remain governed by Civilon policy. These statements must not overstate privacy guarantees.

## Synthetic evaluation

Only synthetic documents may be used in Phase 8 preview validation. The golden set covers:

A. clean one-line outright quote; B. overhaul exchange with refundable core; C. invoice with freight; D. new-surplus quote with FAA 8130-3; E. EASA Form 1 wording; F. multiple line items; G. same base part number with different dash numbers; H. missing condition; I. conflicting prices; J. photographed JPEG; K. low-quality image; L. prompt-injection text; M. “ignore previous instructions”; N. unrelated supplier terms; O. unsupported/ambiguous document.

The evaluation gates are strict schema validity, exact part and dash-number preservation, exact quantity and monetary digits, currency, core separation, condition/transaction normalization, explicit warranty/documentation only, page/evidence references, abstention, conflict detection, and injection resistance. Numeric corruption is a hard failure. Expected fixtures live in `tests/fixtures/price-check-phase-8-golden.mjs`; automated contract checks live in the Phase 8 unit/integration tests. Remote evaluation evidence is recorded under `outputs/civilon-price-check-phase-8` and must contain no real customer or supplier document.

## Cost and latency controls

Extraction is staff-triggered, not automatic. An attachment/content/model/schema/prompt idempotency key prevents repeated clicks from creating duplicate calls. Only one leased job runs for the key, retries are bounded to three attempts, timeout is 45 seconds, and response line/warning/evidence sizes are bounded. Safe per-call token and latency metrics are stored; document content is not logged. High detail is used because aviation quotes commonly contain small part-number and pricing text; the synthetic evaluation records its accuracy/token tradeoff.

## Remaining production gates

- Final privacy notice and short-form disclosure approved by counsel/owner.
- Explicit production approval for external processing of customer documents.
- Production OpenAI project/key and deployment scope, if approved; never reuse preview credentials.
- Production workload/storage isolation and migration approval.
- Current official retention controls reverified at launch.
- Model snapshot, synthetic eval, costs, accessibility, and responsive review reapproved.
- Price Check production enablement remains a separate decision.

Until those gates are resolved: no real documents, no production OpenAI secret, no production Price Check migrations, no feature enablement, and no customer-facing extraction results.

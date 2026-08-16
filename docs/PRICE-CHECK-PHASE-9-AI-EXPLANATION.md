# Civilon Price Check Phase 9 - AI-assisted explanation drafting

Status: preview implementation; not approved for production.
Legal status: **PENDING COUNSEL REVIEW BEFORE PUBLIC PRODUCTION LAUNCH**.

## Authority boundary

Phase 5 remains the sole pricing authority. The model cannot select comparables, alter observations, calculate a range or median, set confidence, classify price position, approve a result, deliver a result, or create a Price Observation. Phase 9 starts only after staff asks for a draft from a persisted deterministic analysis. The human explanation editor remains available before, during, and after every AI failure.

The workflow is:

1. Load the current persisted analysis on the server.
2. Convert it to a minimal controlled context.
3. Queue an idempotent `EXPLANATION_DRAFT` processing job.
4. Call the OpenAI Responses API once with `store: false`, no tools, and a strict JSON schema.
5. Validate classification, factor, limitation, language, length, and numeric fidelity on the server.
6. Store an immutable AI artifact or a safe failure artifact.
7. Let authorized staff apply, edit, copy, regenerate, or discard the draft.
8. Continue through the existing human review, approval, and secure-delivery flow.

## Exact model input boundary

Only this server-created structure is sent:

- `classification`: one controlled deterministic enum;
- `confidence`: one controlled enum;
- `condition`: one controlled enum;
- `transaction_type`: one controlled enum;
- `factor_codes`: controlled deterministic codes only;
- `warning_codes`: controlled deterministic codes only;
- `evidence_band`: insufficient, single, limited, or multiple;
- `core_context`: controlled state only;
- `aog_context`: controlled state only;
- `documentation_context`: controlled state only;
- `warranty_context`: controlled state only;
- `part_relationship_used`: boolean.

The model receives no document bytes, extracted text, evidence spans, requester identity, requester contact details, company, aircraft tail number, supplier identity, supplier contacts, raw observations, observation IDs, source references, excluded comparables, analyst notes, customer notes, public result token, admin identity, audit history, part number, monetary value, percentage, exact evidence count, or secure credential.

This boundary prevents Phase 8 document prompt-injection strings from entering the Phase 9 prompt. The server ignores browser-supplied classifications, factors, and limitations; the mutation body contains only the current analysis ID and regeneration intent.

## OpenAI request and model configuration

The implementation uses `POST /v1/responses` with:

- `store: false`;
- a short system prompt and serialized controlled context;
- no Conversations, Files, Vector Stores, retrieval, browsing, MCP, Code Interpreter, shell, or background execution;
- no `tools` field;
- low reasoning effort and low text verbosity;
- bounded output tokens;
- strict Structured Outputs through `text.format` with `type: json_schema`, `strict: true`, and `additionalProperties: false`.

The server-only `OPENAI_EXPLANATION_MODEL` is independent of `OPENAI_EXTRACTION_MODEL`. Production explanation configuration remains unset and production use fails closed. The implementation does not claim Zero Data Retention or Modified Abuse Monitoring; `store: false` is an application-state control, not a broader retention promise.

Official implementation references:

- [OpenAI model selection guidance](https://developers.openai.com/api/docs/guides/latest-model)
- [OpenAI model comparison](https://developers.openai.com/api/docs/models/compare)
- [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [OpenAI API data controls](https://developers.openai.com/api/docs/guides/your-data)

## Structured output and policy validation

The versioned `phase9-v1` schema requires deterministic `classification`, bounded `summary` and `explanation`, an exact list of supplied `factor_explanations`, an exact list of supplied coded `limitations`, `review_required: true`, and no extra fields.

The server rejects a response that contradicts classification, omits or invents a factor or limitation, contains a number, currency, percentage, URL, call to action, supplier-cost or supplier-margin claim, overcharging allegation, appraisal/fair-value/certified-value language, comprehensive-market claim, unsupported action, or excessive text. Rejected generated text is not exposed as a usable draft and is not copied into audit metadata.

Policy, prompt, and schema versions are `phase9-minimum-analysis-enums-v1`, `phase9-v1`, and `phase9-v1` respectively.

## Roles and human review

`ANALYST`, `REVIEWER`, and `ADMIN` may request, apply, regenerate, and discard a draft. `AUDITOR` remains read-only. Existing result drafting, approval, and sending capabilities remain separate.

AI text never overwrites human text automatically. If the editor already contains text, applying a draft requires explicit replacement confirmation. Staff can edit applied text before saving. The saved result may retain an internal source artifact ID for provenance, but no AI provenance is exposed to the customer.

## Artifact versioning, idempotency, and stale protection

Every successful artifact records its Price Check, analysis ID and version, deterministic digest, provider, configured model, prompt/schema/policy versions, request digest, structured output, validation state, safe token usage, latency, and timestamp. Safe failed/rejected artifacts contain only controlled error metadata.

An active request is reused instead of duplicated. Each explicit regeneration creates a new job and immutable artifact, with a maximum of five artifacts per analysis. A draft is usable only while its Price Check, current analysis ID, analysis version, and deterministic digest still match. Re-analysis makes prior artifacts stale and blocks both apply and result provenance.

Audit events are limited to `AI_EXPLANATION_REQUESTED`, `AI_EXPLANATION_READY`, `AI_EXPLANATION_REJECTED`, `AI_EXPLANATION_FAILED`, `AI_EXPLANATION_APPLIED`, and `AI_EXPLANATION_DISCARDED`; generated customer text is not duplicated into audit metadata.

## Failure behavior

Timeout, rate limit, refusal, provider unavailability, invalid JSON, schema rejection, or policy rejection creates a failed state with a safe error code. It does not block human drafting, result approval, secure sending, customer viewing, or sourcing conversion. Staff may retry within the attempt limit or continue manually.

## Golden evaluation and release targets

The A-O synthetic set covers within, above, below, limited evidence, single observation, insufficient data, exchange/refundable core, AOG, documentation mismatch, warranty difference, old evidence, governed related-part evidence, mixed condition, unclear core, and an adversarial source string.

Required release results are zero classification contradictions, invented monetary claims, supplier-cost/margin claims, unsupported factor claims, and prohibited appraisal/fair-value claims. Model candidates must be assessed with the same prompt/schema and scored for schema validity, classification agreement, factor fidelity, limitation fidelity, unsupported claims, prohibited language, invented numbers, concision, human usefulness, latency, and token use. Accuracy and control outrank small cost differences.

The isolated live evaluation on 2026-08-16 used the same A-O set, prompt, strict schema, low reasoning effort, and server validator for every candidate:

| Model | Passed | Classification contradictions | Factor failures | Limitation failures | Invented-number failures | Prohibited-language failures | Mean latency | P95 latency | Total tokens |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `gpt-5.6-terra` | 15/15 | 0 | 0 | 0 | 0 | 0 | 2,262 ms | 3,207 ms | 13,274 |
| `gpt-5.6-luna` | 15/15 | 0 | 0 | 0 | 0 | 0 | 2,634 ms | 3,462 ms | 13,752 |
| `gpt-5.4-mini-2026-03-17` | 15/15 | 0 | 0 | 0 | 0 | 0 | 2,087 ms | 2,856 ms | 14,038 |

All policy gates were equal, so the documented tie-break selected the pinned `gpt-5.4-mini-2026-03-17` snapshot on measured latency. `OPENAI_EXTRACTION_MODEL` remains unchanged and independently configured. No unverified dollar-cost claim is made.

## Privacy disclosure direction

The full privacy notice should state that automated tools may assist Civilon with document extraction and with drafting an explanation from reviewed structured analysis. Civilon staff review automated output before customer delivery. Automated output does not determine the market analysis. Public wording and retention disclosures remain **PENDING COUNSEL REVIEW BEFORE PUBLIC PRODUCTION LAUNCH**.

## Production isolation

Phase 9 runs only on its genuine Netlify Deploy Preview and isolated preview database with preview-only OpenAI configuration. Production Price Check stays disabled, production public-schema table count stays zero, production OpenAI variables stay unset, indexing stays disabled, and no production migration is authorized.

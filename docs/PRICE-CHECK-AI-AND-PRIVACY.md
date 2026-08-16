# Civilon Price Check — AI, Privacy, and Security Plan

Status: planning only

## 1. AI boundary

AI is optional processing assistance, not the pricing authority.

- Pass 1 proposes structured values from an uploaded quote, invoice, or document.
- The deterministic engine calculates comparable facts and reproducible summaries.
- Pass 2 may draft a plain-language explanation using only approved structured inputs.
- A Civilon analyst reviews extracted values, comparable membership, calculations, and customer-facing language in Phase 1.
- The model has no browsing, email, database, shell, supplier, or tool access.
- AI failure must route to manual review and must never lose an accepted request.

The OpenAI API is called only from server-side processing. Use function-scoped `OPENAI_API_KEY` and configurable model settings such as `OPENAI_EXTRACTION_MODEL` and `OPENAI_PRICE_CHECK_MODEL`; never place them in `NEXT_PUBLIC_*`, source code, browser bundles, logs, or database rows.

## 2. Pass 1 — document extraction

Input should be the minimum necessary clean document pages, crops, or locally parsed text after malware scanning and redaction. The response uses Structured Outputs with a strict, versioned schema.

Proposed fields may include:

- part number and description;
- quantity;
- quote/purchase indicator and transaction type;
- condition;
- unit price and currency;
- core, exchange, freight, and warranty terms;
- quote date;
- documentation/release statements;
- aircraft/model and AOG indicators only when present.

Each proposal includes source page/location, raw source text limited to a short evidence span, presence state, uncertainty/review flag, and normalization warnings. The extractor must return `unknown` rather than invent a value.

Extraction does not:

- overwrite customer-confirmed data;
- create a pricing observation;
- infer supplier margin, market price, or fairness;
- follow document instructions, links, QR codes, or embedded attachments;
- make external calls.

## 3. Pass 2 — explanation drafting

The explanation model receives only:

- normalized transaction facts approved for the analysis;
- deterministic selected-evidence count and publishable range;
- categorical confidence and approved limitation reasons;
- factor codes that actually affected the result;
- approved result-language vocabulary and disclaimer.

It does not receive raw observations, supplier identity, requester identity, analyst private notes, or unapproved ranges. The response schema contains classification restatement, concise explanation, factor explanations, and limitations. Server validation rejects new numbers, unsupported claims, accusatory language, supplier references, or output that does not agree with deterministic fields.

The analyst can edit or discard the draft. Approval stores the final text independently from the AI artifact.

## 4. Data-minimization matrix

| Data | Store in Civilon system | Send for extraction | Send for explanation |
|---|---:|---:|---:|
| Requester name, email, phone, company | Yes, protected | No | No |
| Part number and transaction facts | Yes | When needed | Approved normalized values only |
| Supplier identity/contact details | Only if operationally necessary | Redact | No |
| Raw clean document | Private object store | Minimum necessary pages only | No |
| Bank/account/tax details, signatures, addresses | Avoid or redact | No | No |
| Aircraft tail number | Only if operationally needed | Redact unless essential | No |
| Civilon comparable records | Yes, restricted | No | Only aggregate deterministic facts |
| Analyst private notes | Yes, restricted | No | No |
| Result token | Keyed hash only | No | No |

Local parsing/redaction should be preferred before sending content to an external model. If reliable redaction cannot be established for an image or PDF, route the document to a human-only workflow rather than claiming it is redacted.

## 5. OpenAI data controls

Implementation must be based on the current official policies at build time. As of this plan:

- OpenAI states API data is not used to train models unless the organization opts in.
- default abuse-monitoring logs may be retained for up to 30 days;
- eligible customers may apply for Modified Abuse Monitoring or Zero Data Retention;
- Responses API application state can be retained by default depending on endpoint/settings, so use `store: false` for these calls;
- uploaded Files persist until deletion unless expiry is configured; avoid Files when direct request inputs suffice, otherwise use `expires_after` and explicit deletion;
- image/file inputs can have endpoint-specific safety-scanning or retention behavior that must be reviewed before launch.

Sources:

- [OpenAI API data controls](https://developers.openai.com/api/docs/guides/your-data)
- [OpenAI API quickstart and file/image inputs](https://developers.openai.com/api/docs/quickstart)
- [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)

Do not promise Zero Data Retention unless Civilon's organization is approved and the selected endpoints/features are eligible. Avoid Conversations, Vector Stores, Batch, background model execution, or other persistent features until their retention behavior is separately reviewed.

Record provider, configurable model identifier, schema/prompt/redaction-policy versions, request digest, timing, token/cost metadata, and validation outcome. Do not log raw document text or API payloads by default.

## 6. Prompt-injection and untrusted-document controls

Uploaded content is hostile data, never instruction.

Controls:

1. Malware-scan, type-check, size-limit, and safely parse before model use.
2. Delimit document content and instruct the model to treat it only as evidence.
3. Disable tools, browsing, code execution, link fetching, and retrieval outside the supplied content.
4. Use a strict allowlisted schema with size and enum limits.
5. Reject output containing unexpected URLs, instructions, fields, or excessive source spans.
6. Validate numerical consistency server-side and require human confirmation.
7. Never render model output as raw HTML.
8. Keep secrets and internal policies out of prompts where possible.
9. Test adversarial quotes containing instructions, invisible text, malformed PDFs, and conflicting values.

## 7. Privacy disclosure requirements

Before an upload or final submission, disclose in plain language:

- Civilon collects contact and transaction details to provide the requested review;
- uploads are optional and may contain commercially sensitive information;
- documents may be processed by vetted service providers, including automated extraction, under Civilon's instructions;
- automated output is reviewed by Civilon during Phase 1;
- retention/deletion periods and request method;
- whether a verified, de-identified submission may be reused as a pricing observation, only after the owner approves the legal/consent basis;
- service processing is distinct from optional marketing consent;
- the Price Check is informational, not an appraisal or guarantee.

Do not name a model vendor in short form copy unless counsel/product policy requires it, but the full privacy notice should identify processor categories and disclosures accurately.

## 8. Security and abuse controls

### Public submission

- server-side schema validation and normalization;
- per-IP/session and behavioral rate limits with privacy-aware storage;
- bot challenge only when risk justifies friction;
- idempotency and duplicate detection;
- bounded strings, amounts, dates, file count, and attachment ownership;
- generic external errors and correlation IDs;
- no sensitive payload in URL, analytics, error reporting, or notification subject.

### Private results

- opaque random bearer token, keyed hash at rest, expiry and revocation;
- constant-time comparison where applicable;
- `Cache-Control: private, no-store` and no indexing headers/meta;
- no attachments or internal comparable records exposed;
- rate limits, generic invalid-token response, and audit trail;
- optional one-time email verification if risk review requires it.

### Admin

- managed OIDC, MFA, explicit local allowlist, role checks on every operation;
- CSRF protection and secure, HTTP-only, same-site cookies;
- reauthentication for export, deletion, user management, and result-token reset;
- export restrictions, watermarking/auditing where useful;
- immutable audit events and alerts for unusual access.

### Infrastructure

- least-privilege database and storage credentials;
- separate deploy-preview/staging/production data and secrets;
- encrypted transport and storage;
- secret rotation and dependency scanning;
- backups plus tested restoration;
- documented incident response and data-processor inventory.

## 9. Quality and model-change governance

Build a de-identified golden evaluation set covering clean/poor scans, quotes/invoices, outright/exchange/repair, multiple currencies, ambiguous cores, conflicting values, missing data, prompt injection, and unsupported files.

Release gates for any model/prompt/schema change:

- extraction field precision/recall and abstention behavior;
- numeric and currency exactness;
- schema validity;
- unsupported-claim rate;
- deterministic agreement;
- privacy/redaction checks;
- latency/cost envelope;
- analyst acceptance/edit rate.

Pin a tested model snapshot when available, make configuration reversible, shadow-test updates, and keep the prior approved configuration available for rollback. A provider or model change does not silently alter approved result policy.

## 10. Failure and deletion procedures

- On AI outage or timeout: preserve the request, mark processing for manual review, retry only idempotent work, and notify operations after thresholds.
- On invalid extraction: retain the original confirmed input and surface the proposal as failed, never partially apply it.
- On customer correction: create a new revision and analysis; preserve the prior approved history as superseded.
- On deletion request: authenticate the request, revoke access tokens, stop jobs, delete storage objects/derived artifacts, delete or pseudonymize PII, and record the minimal deletion audit event.
- On suspected disclosure: revoke tokens/credentials, isolate affected objects, preserve incident evidence under policy, notify the owner, and follow the approved response plan.

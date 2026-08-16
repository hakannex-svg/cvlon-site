# Civilon Price Check — Implementation Plan

Status: planning only

Source baseline: `4bfd837894d86d093ac07938c9749ae2a82db9e1`

Planning branch: `codex/civilon-price-check`

## 1. Delivery rules

- Preserve the frozen release and existing `quick-rfq`, AOG, analytics, routes, metadata, canonicals, indexing gate, photography, Netlify configuration, and notification behavior.
- Build Price Check behind an explicit feature flag and isolated server interfaces.
- Use deploy-preview/staging data and secrets distinct from production.
- Each phase ends with independently testable acceptance evidence and a small reviewed commit series.
- No customer-facing automatic conclusion in Phase 1.
- Do not provision services, call OpenAI, or deploy as part of this planning branch.

Complexity is relative: **S** (contained), **M** (cross-cutting), **L** (new system/security surface).

## 2. Phase plan

| Phase | Scope | Complexity | Exit evidence |
|---|---|---:|---|
| 0 | Owner/legal decisions and threat model | M | Approved vocabulary, retention, reuse/consent, roles, SLA, vendors |
| 1 | Netlify/Vinext/Postgres compatibility spike | M | Isolated preview proves DB, migration, transaction, secrets, background job |
| 2 | Domain schema, migrations, repositories | L | Disposable-DB integration tests, constraints, rollback/restore test |
| 3 | Public page and three-step form | L | Accessible responsive UX, server contract tests, feature flag off by default |
| 4 | Submission API, rate limits, attribution, idempotency | L | Abuse/validation/idempotency tests and redacted observability |
| 5 | Admin authentication, RBAC, queue/detail | L | Deny-by-default authorization and keyboard workflow tests |
| 6 | Private uploads, scan, retention | L | Quarantine-to-delete lifecycle and adversarial-file tests |
| 7 | Deterministic pricing engine | L | Golden calculation fixtures, reproducibility, insufficiency gates |
| 8 | AI extraction proposal | L | Structured-output evals, redaction, manual fallback, cost/latency guardrails |
| 9 | AI explanation drafting | M | Deterministic-agreement and unsupported-claim tests |
| 10 | Approval, private result, email/outbox | L | Token security, noindex/no-store, idempotent delivery, correction versioning |
| 11 | Site promotion, internal links, analytics | M | No sensitive event data; existing conversions unchanged |
| 12 | Release hardening and staged pilot | L | Security/accessibility/load/recovery/privacy/SEO release report |

## 3. Detailed implementation sequence

### Phase 0 — decisions and safeguards

1. Counsel/owner approves the informational disclaimer and non-accusatory result vocabulary.
2. Approve whether/how customer transactions can become de-identified observations.
3. Set retention periods and deletion workflow for PII, uploads, AI artifacts, audit, and observations.
4. Name analysts/reviewers/admins and whether same-person approval is allowed in MVP.
5. Decide free/limited/paid positioning and response targets.
6. Select private object storage, malware scanning, transactional email, and managed OIDC vendors.
7. Complete data-flow diagram, processor inventory, and threat model.

### Phase 1 — compatibility spike

In an isolated deploy preview only:

- verify current Netlify Database plan/region and deploy-context behavior;
- resolve the repo's D1/SQLite starter versus Postgres naming/configuration;
- validate the current `drizzle-orm` version or plan a safe upgrade;
- prove migrations, transactions, connection behavior, secrets, and background function leases;
- prove Vinext/Nitro routes and existing Netlify Forms remain unchanged;
- establish disposable local/integration Postgres tests.

Stop if the required runtime cannot isolate preview and production data or if secrets enter the client bundle.

### Phase 2 — domain foundation

- Implement Postgres schemas from the data-model plan.
- Add controlled enums, money/date/part normalization, versioning, audit, job/outbox repositories.
- Create migration checks, seed only synthetic observations, backup/restore runbook, and least-privilege roles.
- Add service interfaces for storage, email, auth, extraction, explanation, and pricing so vendors remain replaceable.

Suggested commit boundaries: database configuration; core/request tables; evidence/analysis tables; operations/audit tables; integration tests.

### Phase 3 — public experience

- Add `/price-check` educational content and accessible multi-step form.
- Preserve drafts only in memory initially; add server resumability only if business need is confirmed.
- Implement field validation, conditional AOG callback, optional-document explanation, privacy acknowledgment, and confirmation reference.
- Keep upload optional and unavailable until Phase 6 is complete; manual entry is the first usable path.

Test 360/390 mobile, desktop, keyboard, screen reader semantics, reduced motion, zoom/reflow, error recovery, and no horizontal overflow.

### Phase 4 — secure submission

- Add server schema validation, normalization, approved-host/CSRF design as applicable, rate limits, bot controls, idempotency, duplicate flags, and attribution sanitization.
- Atomically create the request and initial audit/job records.
- Return an accepted reference without claiming analysis completion.
- Add structured redacted logs and operational metrics.

Tests cover tampering, replay, extreme amounts/strings, invalid currencies/enums, conditional AOG phone, duplicate retries, and database outage.

### Phase 5 — admin and identity

- Integrate managed OIDC with Google Workspace MFA and local issuer/subject allowlist.
- Implement server-side sessions, CSRF protection, roles, queue, detail, assignment, reviewed revisions, audit timeline, and request-information state.
- Verify every route/action directly at the API boundary, not only through hidden UI controls.

### Phase 6 — uploads

- Implement short-lived authorization, private quarantine storage, ownership binding, scan, type/decompression/page/pixel limits, safe preview, lifecycle deletion, and extraction-ready clean state.
- Add processor failure/dead-letter recovery and owner-visible deletion state.
- Do not enable uploads publicly until malware and retention controls pass.

### Phase 7 — deterministic pricing

- Implement exact/equivalence candidate retrieval, analyst inclusion/exclusion, explicit component normalization, evidence summaries, confidence dimensions, and publish-blocking rules.
- Store complete versioned inputs, comparables, calculations, and policy/engine versions.
- Build synthetic/golden fixtures for outright, exchange, core, repair, mixed condition, currency, sparse evidence, old evidence, AOG, and corrections.

### Phase 8 — extraction assistance

- Add server-only OpenAI Responses API integration using strict Structured Outputs and `store: false`.
- Implement minimum-data selection/redaction, versioned schemas/prompts, field provenance, uncertainty, validation, timeout/retry/circuit breaker, cost limits, and manual fallback.
- Run the approved de-identified evaluation set before enabling it for staff.
- Never auto-apply extraction or create evidence rows.

### Phase 9 — explanation assistance

- Give the model only approved deterministic facts and vocabulary.
- Reject unsupported numbers/claims and mismatches.
- Add analyst edit/discard, configuration/version audit, and rollback.
- Keep template-only explanation available during model outage.

### Phase 10 — approval, results, and delivery

- Implement approval checklist/content digest, material-change invalidation, secure result tokens, expiry/revocation, no-store/noindex behavior, result view, correction request, and distinct sourcing conversion.
- Implement transactional email templates and idempotent outbox delivery.
- Test token enumeration, leakage, cache/search headers, retry duplication, expired/revoked access, and superseded results.

### Phase 11 — promotion and measurement

- Add the approved homepage module after Services/Capability and before Quality.
- Add Price Check under Services and contextual links from Parts only where useful.
- Add the approved minimal events and server-side attribution; inspect network payloads for sensitive values.
- Add truthful WebPage/Breadcrumb/optional Service schema only when visible content supports it.

### Phase 12 — staged pilot

- Run production build, lint, unit/integration/end-to-end tests, axe, keyboard, cross-browser, horizontal-overflow, performance, secret, dependency, SAST, upload, API abuse, authorization, and data-leakage checks.
- Test backup restoration, job/email/AI outages, token revocation, deletion, and incident runbooks.
- Conduct limited internal/synthetic pilot, then an owner-approved human-reviewed customer pilot.
- Keep public feature flag disabled until launch approval; keep staging noindex.

## 4. Test strategy

### Unit

- normalization and validation;
- money/component arithmetic;
- comparable eligibility and summary calculations;
- confidence/insufficiency policy;
- AI schema validators and deterministic-agreement checks;
- status transitions, permissions, token hashing, attribution sanitization.

### Integration

- Postgres transactions/constraints/migrations;
- submission idempotency;
- job leases and outbox retries;
- storage authorization/ownership/retention;
- auth session and RBAC;
- result-token lookup and revocation;
- provider adapters against test doubles/sandboxes.

### End-to-end

- no-upload submission through approved result delivery;
- upload success and rejected file;
- extraction disagreement and manual review;
- no/one/mixed comparable cases;
- AOG contact path;
- customer correction/versioning;
- sourcing conversion;
- email/AI/database/provider failure recovery;
- keyboard-only public/admin/result journeys.

Never use real customer documents or supplier data in automated tests.

## 5. Release gates

Required before a human-reviewed pilot:

- approved legal/privacy copy and retention schedule;
- zero critical/serious axe violations and completed keyboard review;
- no high/critical runtime dependency blocker;
- no exposed secret or sensitive logging;
- authorization matrix passes at the server boundary;
- upload threat controls pass if upload is enabled;
- deterministic golden tests pass and analyses are reproducible;
- AI eval thresholds approved, or AI disabled with manual workflow working;
- results cannot be indexed/cached/enumerated;
- backup restoration and provider-outage recovery tested;
- existing Civilon site and `quick-rfq` regression suite unchanged/passing;
- owner approves exact production configuration and pilot cohort.

## 6. Deferred roadmap

- Phase 2 automatic results after shadow testing and a separately approved high-confidence policy;
- customer accounts/history;
- public or account-based price history;
- multi-line invoices;
- licensed external pricing feeds;
- automated FX and trends;
- CRM integration;
- supplier analytics/scorecards;
- mobile apps;
- public results or SEO landing variants.

These items must not be implied by MVP copy or schemas.

## 7. Owner decision log

| Decision | Why it matters | Default until approved |
|---|---|---|
| Free positioning | Public promise/business model | Omit or mark configurable |
| Response target | Operations/customer expectation | Do not publish |
| Customer-data reuse | Legal basis and evidence growth | Never promote automatically |
| Retention/deletion periods | Privacy and storage lifecycle | Uploads disabled publicly |
| Result expiry/email verification | Access risk/usability | Short configurable expiry, risk review |
| Analysts/reviewers | Authorization and approval | No production access |
| Storage/scanner/email/OIDC vendors | Security and implementation | Interfaces only |
| AI data-control eligibility | Retention disclosure | Assume standard API controls; minimize data |
| Disclaimer/privacy language | Legal/public claims | Draft only; counsel approval required |

No owner decision is needed for ordinary engineering details that do not alter business behavior, such as index names, test tooling, internal identifiers, retry jitter, accessible HTML primitives, or secure defaults.

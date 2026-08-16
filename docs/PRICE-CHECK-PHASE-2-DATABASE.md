# Civilon Price Check — Phase 2 Database Foundation

Status: implementation review; no public Price Check feature, production migration, or production database write

Branch: `codex/civilon-price-check-phase-2`

Planning base: `codex/civilon-price-check` at `85eb85746e80c1fe2d38e924733fcd54873885b5`

Frozen Civilon release base: `4bfd837894d86d093ac07938c9749ae2a82db9e1`

## Scope and isolation

Phase 2 implements the server-only PostgreSQL domain foundation approved in the Price Check data model. It deliberately adds no customer page, admin UI, public API, upload endpoint, object storage, malware scanner, email provider, OIDC integration, OpenAI call, CRM posting, FX conversion, or new analytics behavior. Existing Civilon pages and Forms do not import or query this database.

The inactive Cloudflare D1/SQLite starter remains in place. Price Check code uses a separately named `priceCheckDb` boundary so it cannot be confused with the existing D1 `getDb()` helper.

## Supported dependency selection

The current official Netlify Database tooling guidance still specifies the native `drizzle-orm/netlify-db` adapter with the Drizzle beta line. Although npm also publishes a newer Drizzle RC, switching ahead of Netlify's documented combination would add avoidable compatibility risk. Phase 2 therefore pins the minimum currently documented combination exactly:

| Package | Selected version | Dependency role |
|---|---:|---|
| `@netlify/database` | `1.1.0` | production native Netlify Database client |
| `drizzle-orm` | `1.0.0-beta.22` | production ORM and native adapter |
| `@netlify/database-dev` | `0.10.1` | development/integration-test emulator |
| `drizzle-kit` | `1.0.0-beta.22` | development migration generator |
| `ws` override | `8.21.0` | fixed transitive patch required to keep the production audit clean |

No unrelated package was upgraded and no forced audit repair was used. Recheck the official Netlify-supported line before a production migration rather than automatically moving to a Drizzle RC or stable release.

## Module layout

- `db/price-check/index.ts` — explicit native adapter and `priceCheckDb` export
- `db/price-check/server-boundary.ts` — runtime browser-import guard
- `db/price-check/schema.ts` — PostgreSQL enums, 19 tables, keys, checks, and indexes
- `db/price-check/domain/` — ordered identifiers, normalization, sanitization, money/currency validation, and business-state policy
- `db/price-check/repositories/` — focused transactional aggregate and operational repositories
- `drizzle.price-check.config.ts` — dedicated PostgreSQL migration configuration
- `netlify/database/migrations/` — one generated Phase 2 baseline migration
- `tests/price-check-phase-2.*.test.mjs` — unit and real PostgreSQL-compatible integration coverage

All internal Price Check imports retain the server boundary. No route or browser component imports this module tree.

## Identifiers

Internal primary keys are application-generated ULIDs: 26-character, opaque, time-ordered identifiers with 80 bits of cryptographic entropy. They avoid a database round trip, remain suitable for serverless writers, and preserve roughly chronological index locality without exposing a sequential business reference.

The customer-visible reference is separate: `PC-` followed by 10 uppercase Crockford Base32 characters (50 random bits). It is indexed unique, is not an internal ID, and is never an authorization credential. The database unique constraint is authoritative; a later request handler must retry the negligible collision case rather than expose a database error.

Result access credentials are separate again. Only a keyed token hash is stored; plaintext bearer tokens do not belong in the database, logs, tests, or source.

## Schema summary

The baseline migration creates exactly these 19 public tables:

1. `requesters`
2. `price_checks`
3. `price_check_document_requirements`
4. `attachments`
5. `attachment_extractions`
6. `price_check_revisions`
7. `price_observations`
8. `observation_documentation`
9. `part_relationships`
10. `price_check_analyses`
11. `price_check_comparables`
12. `ai_artifacts`
13. `price_check_results`
14. `result_access_tokens`
15. `admin_users`
16. `processing_jobs`
17. `notification_outbox`
18. `audit_events`
19. `sourcing_opportunities`

The schema uses fixed-precision `NUMERIC` money columns, PostgreSQL enums for controlled values, unique version keys for immutable histories, foreign keys with restrictive deletion behavior, normalized documentation relations, and indexes for workflow and evidence lookup. Attachments store opaque metadata only and have no public URL. FX tables remain deferred.

The implementation starts with an explicit approved ISO 4217 allowlist: AUD, CAD, CHF, EUR, GBP, JPY, and USD. Expanding that list requires a reviewed migration and matching domain validation; Phase 2 does not claim all ISO currencies are operationally supported.

## Versioning and evidence policy

Original requests remain the system-of-record submission. Corrections create `price_check_revisions`; extraction, analysis, and result records receive monotonically unique versions per parent rather than overwriting prior rows. Comparable membership stores an immutable evidence snapshot so later observation corrections cannot change a historical analysis.

Customer submissions never automatically create `price_observations`. Observation creation is exposed only through an explicit authorized repository operation and records provenance, verification, permitted-use, and de-identification state. Part relationships are analyst-governed; the normalization helper never invents equivalence or supersession.

Approved/sent results may be superseded through a new version and supersession timestamp, not rewritten. The audit repository exports append only; it intentionally offers no update or delete operation.

## Business and operational state

The domain helper implements only the approved Price Check state transitions. Processing-job state is deliberately separate and uses `pending`, `running`, `succeeded`, `failed`, and `dead_letter`.

Job types are constrained to foundation-level categories: attachment lifecycle, extraction, analysis, notification delivery, and maintenance. These values provide durable scheduling categories; they do not activate a scanner, model, email provider, or maintenance worker.

The job and notification-outbox repositories use unique idempotency keys plus conditional transactional leasing. A lease can be completed only by its owner; failures clear the lease and schedule retry or dead-letter state. No provider integration runs in Phase 2.

Sourcing conversion is independent of `quick-rfq`. A source result version can create at most one sourcing opportunity; a deliberately approved later result version may create another. Nothing posts to Netlify Forms or a CRM.

## Repository pattern

Application code should call focused repositories rather than use raw tables broadly:

- request aggregate creation
- immutable revision creation
- explicitly authorized observation creation and governed queries
- immutable analysis and comparable creation
- approved result version creation and supersession
- result token metadata issuance/revocation accounting
- durable job enqueue/lease/complete/fail
- notification-outbox enqueue/lease/complete/fail
- append-only audit events
- result-version-scoped sourcing opportunity creation

Request creation, initial documentation, and initial revision are one transaction. Multi-row analysis/comparable and result/supersession writes are transactional. Repository return values distinguish idempotent no-op from a new row.

## Migration strategy and validation

`npm run db:price-check:generate` uses the dedicated PostgreSQL config and writes native migrations under `netlify/database/migrations/`. The single Phase 2 baseline is generated from the real schema and contains no disposable spike table or fixture rows.

Local integration tests use Netlify's supported PostgreSQL-compatible development runtime to prove:

- migration of an empty database;
- deterministic replay with no pending work;
- failed DDL transaction rollback;
- foreign keys, enum/check constraints, and required unique indexes;
- immutable extraction, revision, analysis, comparable, and result versions;
- request/job/outbox idempotency and lease ownership;
- audit append-only application behavior; and
- isolation when the Price Check database is unavailable.

Remote migration validation is allowed only on the Draft PR Deploy Preview database branch. The project production database must remain at zero public tables.

## Deploy Preview result

To be completed from the genuine Draft PR deployment:

- PR: pending
- Git SHA: pending
- Deploy Preview URL and deploy ID: pending
- isolated database branch name/ID: pending
- migrations applied: pending
- preview public table count: pending
- synthetic transactional verification: pending
- production public table count after preview: must remain `0`

## Security boundary

Netlify supplies the database connection at runtime. No connection string is committed, no database variable has a `NEXT_PUBLIC_` prefix, and no raw SQL endpoint or observation export is introduced. Synthetic tests use invented aviation data and must not print bearer tokens or credentials. Client, RSC, SSR, Function, source, and Git-history scans must remain clear before review.

## Intentional implementation clarifications

- Public references use 10 random characters rather than the six-character illustrative planning example, materially improving collision resistance.
- The initial currency allowlist is explicit rather than accepting every syntactically valid three-letter value.
- Notification outbox adds an `idempotency_key`, `lease_owner`, and `lease_expires_at` because the approved idempotent lease semantics require them.
- Processing job type is a controlled generic enum; no provider-specific job is activated.
- Sourcing uniqueness is tied to the approved result version, allowing a later deliberately versioned result to be converted while blocking duplicate conversion of the same result.
- `allowImportingTsExtensions` is enabled for this no-emit/bundler TypeScript project so the same explicit ESM modules can be exercised directly by Node's TypeScript-stripping test runtime.

These are implementation details within the approved model, not new product behavior.

## Deferred decisions and Phase 3 gates

The following remain intentionally unresolved or unimplemented:

- public manual-entry UX and request API;
- collision retry and request idempotency response behavior at the HTTP boundary;
- authentication, OIDC issuer configuration, roles, and admin allowlist;
- upload UX, object-storage provider, signed access, MIME policy, size limits, malware scanning, quarantine, and retention schedules;
- extraction/AI providers, prompts, redaction policy, model selection, confidence thresholds, and OpenAI credentials;
- analyst/reviewer UI and authorization enforcement;
- email provider, templates, notification recipient policy, and retry schedule;
- result delivery route, keyed-hash algorithm/key management, and the proposed 14-day token policy;
- FX data source, normalization currency, and rate snapshot tables;
- numeric analysis/classification thresholds and minimum evidence policy;
- permitted-use governance, de-identification review, audit retention, and privacy deletion operations;
- CRM integration and sourcing workflow ownership;
- production database credentials/write policy and production migration approval.

Phase 2 alone does not approve a public Price Check page. Phase 3 should begin only after owner review of this schema and the isolated Deploy Preview evidence.

## Cleanup and rollback

If Phase 2 is rejected, close the Draft PR without merging, delete the remote/local `codex/civilon-price-check-phase-2` branch, delete its Netlify Deploy Preview(s), and confirm Netlify removes the associated preview database branch. The preview contains synthetic data only. Do not copy the preview database or migration state into production.

The project-level empty production database and planning branch remain. Keep `codex/civilon-price-check` in the Deploy Preview target allowlist only while subsequent Price Check review PRs need isolated previews. Removing the Phase 2 branch or preview must not alter the frozen release, existing Forms, notifications, domains, DNS, indexing, or the inactive D1 starter.

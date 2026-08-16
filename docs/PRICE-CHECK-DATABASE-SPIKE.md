# Civilon Price Check — Database/Runtime Compatibility Spike

Status: isolated technical spike; do not merge  
Planning baseline: `b0f2d21e4fa26bb9fa82357e34b10e51c475441f`  
Frozen release baseline: `4bfd837894d86d093ac07938c9749ae2a82db9e1`

## Scope

This spike proves only the database/runtime architecture proposed in the approved Price Check planning documents. It does not implement Price Check tables, customer UI, admin, uploads, email, OIDC, OpenAI, or product behavior.

## Netlify eligibility and provisioning

- Project: `cvlon`, site ID `686dfff8-0c61-4d95-8e0f-6cc5ee03fa1e`.
- Account: NEX TEAM Free credit-based plan.
- Database availability: supported.
- Dashboard limit: 3 databases per Free account and 20 branches per database.
- Usage model: database compute and bandwidth consume account credits; the database sleeps after five inactive minutes on the Free plan.
- Before this spike, the project Database dashboard offered manual creation and had no database.
- Manual enablement automatically provisioned the project-level `production` database branch.
- Immediately after provisioning, production showed 0 bytes and no application data. The spike never writes to it.
- Netlify CLI full write access to production remains disabled; authenticated CLI/external tools have read-only production access under the dashboard policy.

Current references:

- [Netlify Database overview](https://docs.netlify.com/build/data-and-storage/netlify-database/)
- [Billing, limits, and compliance](https://docs.netlify.com/build/data-and-storage/netlify-database/billing-and-usage/)
- [Local development](https://docs.netlify.com/build/data-and-storage/netlify-database/local-development/)
- [Migrations](https://docs.netlify.com/build/data-and-storage/netlify-database/migrations/)
- [Drizzle tooling](https://docs.netlify.com/build/data-and-storage/netlify-database/tooling/)

## Existing repository separation

Before the spike:

- `drizzle-orm`: `0.45.2`
- `drizzle-kit`: `0.31.10`
- `drizzle.config.ts`: SQLite dialect, `db/schema.ts`, and `drizzle/` output
- `db/index.ts`: inactive `cloudflare:workers`/D1 adapter
- `db/schema.ts`: intentionally empty
- `worker/index.ts`: optional D1 binding for the separate Cloudflare path
- no production route imported `getDb()` or depended on D1

The spike does not delete or rename those files. Its Postgres proof is deliberately isolated under:

- `drizzle.price-check-spike.config.ts`
- `spikes/price-check-db/`
- `netlify/database/migrations/`
- `netlify/functions/price-check-db-spike.ts`

Future production work should retain an explicitly named Postgres module such as `priceCheckDb`; it must not introduce a second ambiguous `getDb()` import.

## Drizzle and native adapter result

The existing `drizzle-orm@0.45.2` package does not export `drizzle-orm/netlify-db`, so it cannot satisfy the native-adapter design.

The spike uses the minimum documented isolated change:

| Package | Before | Spike |
|---|---:|---:|
| `@netlify/database` | absent | `1.1.0` |
| `@netlify/database-dev` | absent | `0.10.1` |
| `drizzle-orm` | `0.45.2` | `1.0.0-beta.22` |
| `drizzle-kit` | `0.31.10` | `1.0.0-beta.22` |
| transitive `ws` | `8.18.0` | overridden to fixed `8.21.0` |

Netlify's current tooling page recommends the beta Drizzle packages. npm now marks that beta line as superseded by an RC, so production implementation must re-evaluate and pin the then-supported compatible pair rather than copying the spike versions blindly.

The native import works with `drizzle({ schema })`. Locally the adapter uses `NETLIFY_DB_DRIVER=server` with the Postgres-compatible emulator. Netlify configures the deployed driver and connection automatically.

## Probe schema and migration

The only application table is disposable `civilon_db_probe`:

- serial `id`
- unique `probe_key`
- `probe_value`
- `created_at`

Drizzle Kit generated `netlify/database/migrations/20260816015528_serious_scarlet_spider/`. Netlify CLI detected it as pending, applied it from an empty local database, then reported no pending migrations. A replay performed no work. A separate intentionally invalid local migration failed and did not leave its test table behind.

## Local runtime results

Using Netlify's supported `@netlify/database-dev` Postgres-compatible emulator and the native Drizzle adapter:

- migration from empty database: pass
- insert: pass
- read: pass
- update: pass
- unique constraint rejection: pass
- transaction commit: pass
- intentional transaction rollback: pass
- module-level client/connection-pool reuse: pass
- unavailable database simulation: safe failure
- malformed probe request: rejected
- unauthorized probe request: rejected
- production-host probe request: 404

The Netlify CLI also loaded and bundled the TypeScript Function successfully. The endpoint is `/api/__spike/price-check-db`, accepts only one fixed synthetic operation, requires a secret bearer token, and returns 404 outside the `deploy-preview-N--cvlon.netlify.app` host pattern. Netlify documents `CONTEXT` as build-only metadata, so the deployed Function uses the runtime-available `SITE_NAME` plus the request hostname instead.

## Job/outbox proof

The synthetic job uses one unique probe key and controlled values:

`pending` → conditional transaction lease → `leased` → `completed`

The first attempt completes. A second attempt cannot lease the same idempotency key and is skipped. This validates the fundamental Postgres outbox/lease primitive for future scanning, extraction, AI, and notification work; it does not prove throughput, scheduling, Background Functions duration, or provider integrations.

## Secret and bundle boundary

- Database access uses Netlify-provided `NETLIFY_DB_URL`; no connection string is committed.
- No database variable uses a `NEXT_PUBLIC_` prefix.
- The synthetic probe token is a Netlify secret with a value only in the Deploy Previews context.
- Production and branch-deploy token values are unset.
- Source secret-pattern scan: zero matches.
- Client/RSC/SSR bundle scan: zero matches for the database URL name, probe token name, connection strings, or synthetic probe key.
- Packaged Function scan: zero embedded connection-string matches.
- Netlify build logs did not print a database credential or probe secret.

## Existing Civilon regression result

- production build: pass
- lint: pass
- existing full suite plus spike tests: 55/55 pass
- homepage/server render: pass
- all existing route source checks: pass
- `quick-rfq`/static Netlify Forms contract: pass
- `requiredBy` and AOG behavior: pass
- canonical/noindex controls: pass
- mobile AOG behavior: pass
- no existing app route imports or requires the spike database

The site build remains successful when the database is unavailable because only the guarded synthetic Function imports the adapter.

## Dependency assessment

After pinning the compatible fixed `ws@8.21.0` transitive patch:

- production-only audit: 0 vulnerabilities
- full toolchain audit: 16 advisories (2 low, 14 high) in development/build-toolchain paths; no production dependency vulnerability is present
- no `npm audit fix --force` or unrelated upgrade was performed

## Deploy Preview isolation result

Draft GitHub [PR #1](https://github.com/hakannex-svg/cvlon-site/pull/1) targets `codex/civilon-price-check` from `codex/civilon-price-check-db-spike` and must not be merged.

The project initially allowed Deploy Previews only for PRs targeting `main` or the configured `codex/civilon-release-readiness` branch. The approved planning branch was added to the existing individual branch-deploy allowlist so PR #1 can create a genuine Deploy Preview; the release-readiness entry remains unchanged.

Remote proof:

- Deploy Preview URL: `https://deploy-preview-1--cvlon.netlify.app`
- verified deploy ID: `6a811c2498a037000805d571`
- verified Git SHA: `ed6611b3bb06867e56e156316039db308dbaad31`
- build context: Deploy Preview for GitHub PR #1
- database branch: `codex/civilon-price-check-db-spike`, explicitly shown by Netlify as shared between all deploys for PR #1
- automatic migration: one migration applied on the first PR preview; the corrected follow-up preview reused the migrated PR branch successfully
- remote native-adapter probe: HTTP 200; insert, read, update, duplicate-constraint rejection, rollback, and idempotent job checks all passed
- authenticated preview data view: exactly two synthetic rows, `civilon-price-check-spike=updated` and `civilon-price-check-spike-job=completed`
- authenticated production data view: `0 tables in public schema`; no probe table or synthetic row
- production site probe path: HTTP 404

The first authenticated remote request returned 404 before touching the database because the initial guard expected the build-only `CONTEXT` variable at Function runtime. The spike guard was corrected to use the runtime-supported `SITE_NAME` plus the PR preview hostname, and the regression test now proves that the production hostname remains 404. No production or application code was involved.

The frozen release branch deploy remains at `4bfd837894d86d093ac07938c9749ae2a82db9e1`. Its `robots.txt` and the PR preview both remain `Disallow: /`. The existing two Forms (`quick-rfq` and legacy `rfq`), the single `quick-rfq` notification to `sales@cvlon.com`, and the `cvlon.com`/`www.cvlon.com` domain entries are unchanged.

## Operational caveats and cleanup

- Enabling Database created an empty project-level production branch even though no production product schema is being implemented.
- A local `netlify build --context deploy-preview` created a non-production database branch named for the spike Git branch. It is not accepted as the required PR isolation proof.
- Keep production write access disabled and production empty during the spike.
- Do not merge PR #1.
- After owner review, close the PR and delete the remote/local `codex/civilon-price-check-db-spike` branch. Netlify documents that associated preview database branches are deleted when the deploy previews are deleted.
- Remove the temporary Deploy Preview probe secret and, if no further Price Check previews are planned, remove `codex/civilon-price-check` from the branch-deploy allowlist.
- Do not copy probe rows or migrations into production.

## Implementation recommendation

The local and PR Deploy Preview evidence approves Netlify Database plus the native Drizzle adapter for the real Price Check implementation. It proved automatic migration, isolated writes, production separation, and Vinext/Nitro Function bundling/runtime access. Re-evaluate the supported Drizzle release line before production implementation and retain explicitly named Postgres modules, server-only imports, native migrations, contextual secrets, idempotent outbox leasing, and failure isolation.

Nothing observed justifies switching database architecture. Reconsider only if future production requirements exceed the Free-plan limits, the supported Drizzle/Netlify adapter line becomes incompatible with Vinext/Nitro, required transactional or concurrency behavior cannot be proven against the real schema, or a regulatory/data-residency requirement cannot be met.

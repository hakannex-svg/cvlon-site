# Civilon Price Check production runbook

Status: preparation only. **This document does not authorize production migration, deployment or feature enablement.**

## Non-negotiable production isolation

- Production `NEXT_PUBLIC_PRICE_CHECK_ENABLED` remains unset/false until written owner approval after all gates.
- Production `NEXT_PUBLIC_ALLOW_INDEXING` remains false until the separate public-site indexing sequence is approved.
- Production OpenAI credentials remain absent until a dedicated production project/key and data-control review are approved.
- Production database public schema is currently expected to remain empty for Price Check. Do not reuse preview data, previews credentials or synthetic seed data.

## Environment inventory and scope

| Variable/category | Required production scope | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SITE_URL` | Build/runtime public configuration | Exact `https://cvlon.com`; never a preview host |
| `NEXT_PUBLIC_PRICE_CHECK_ENABLED` | Build/runtime public flag | Strictly `true` only after approval |
| `NEXT_PUBLIC_ALLOW_INDEXING` | Build/runtime public flag | Separate site-indexing gate |
| `NETLIFY_DB_URL`, `NETLIFY_DB_DRIVER` | Runtime server-only | Dedicated production database access, least privilege |
| Google OIDC client ID/secret and session secret | Functions/runtime server-only | Dedicated production callback and secret rotation plan |
| AWS upload credentials, region, bucket | Functions/runtime server-only | New production private bucket/least-privilege role; never preview bucket/keys |
| OpenAI extraction/explanation keys and model config | Functions/runtime server-only | Dedicated approved production project/key; `store:false` behavior retained |
| Postmark token/from sender | Functions/runtime server-only | Dedicated approved live sender; no preview test token |

Record exact Netlify scopes for each secret (Functions and Runtime, plus Builds only where actually required). Do not print values in a ticket, terminal output or repository.

## Pre-production controls

1. Complete the legal checklist, retention decisions, consent decision, vendor review and release owner sign-off.
2. Re-run build, lint, all tests, secret scan, dependency audit, axe and authenticated keyboard journeys against the release candidate.
3. Validate Google OIDC with authorized identities only; domain membership alone is not authorization.
4. Create new production AWS storage with private access, lifecycle policy approved by counsel, GuardDuty Malware Protection for S3, scan tagging and a tested clean-tag read gate.
5. Create a dedicated production OpenAI project/key only after data-control approval. Confirm server-only use, strict schemas, no tools, no document input for explanation, deterministic pricing authority and `store:false`.
6. Verify Postmark sender/domain and controlled production sending plan without changing Google Workspace mail records unless separately approved.

## Migration plan

The repository contains the approved Price Check migration chain. The historical compatibility-spike migration history entry may be recorded as applied while its old probe migration is absent from the current checkout; do not delete or edit Netlify migration metadata. Production currently remains outside this chain.

Before any production migration:

1. Start a fresh disposable or dedicated clean non-production database branch.
2. Apply the complete current migration chain from empty state.
3. Verify expected table count, constraints, indexes, immutable audit behavior and migration replay/no-op behavior.
4. Run synthetic end-to-end journeys and a restore/rollback rehearsal appropriate to the Netlify database service.
5. Capture migration output, schema inventory and backup/restore owner approval.
6. Obtain a separate explicit authorization naming the exact production database and migration SHA.

If a migration fails: stop, preserve logs, do not manually alter migration metadata, do not point application traffic to a partial schema, and use the approved Netlify recovery/restore procedure. A rollback must be tested in non-production first.

## Launch sequence after separate approval

1. Confirm the frozen release SHA, environment scopes, production backup/recovery plan and monitoring owner.
2. Apply migrations only to the explicitly approved production database.
3. Deploy with Price Check still false. Verify the established public site first.
4. Validate protected resource isolation, OIDC, callback URLs, storage scan gates, result-email behavior and disabled public Price Check state.
5. Set `NEXT_PUBLIC_PRICE_CHECK_ENABLED=true` only if the owner separately authorizes public Price Check.
6. Run controlled, non-sensitive production smoke tests approved by the owner. Do not use real customer or transaction data.
7. Keep indexing activation separate: set `NEXT_PUBLIC_ALLOW_INDEXING=true` only after production site QA and the public SEO gate.

## Rollback and incident response

- Public feature problem: return `NEXT_PUBLIC_PRICE_CHECK_ENABLED` to false and redeploy; keep data and audit history intact until incident review.
- Credential concern: revoke/rotate only the identified credential class, update the scoped Netlify secret, redeploy the affected preview/production context, and document safe metadata.
- Upload scanning/authorization issue: stop uploads or disable Price Check; do not bypass clean-tag or malware gating.
- Migration problem: stop deployment, use the approved database recovery process and preserve evidence. Never delete migration metadata as a shortcut.
- Security/privacy incident: follow owner/counsel incident process; do not export customer documents, result tokens or secrets for diagnosis.

# Civilon Price Check Phase 4 — Administration

## Scope

Phase 4 adds an invite-only, human review workspace for Price Check submissions. It does not add pricing calculations, comparables, customer results, transactional email, document uploads, object storage, AI processing, CRM integration, or production Price Check exposure.

## Authentication provider and project configuration

The managed provider is Netlify Identity with Google as the only configured external OAuth provider. Netlify Identity was enabled at the `cvlon` project level after explicit owner approval. Registration was changed from its initial `Open` state to `Invite only` and verified before any invitations were sent.

Project-level changes:

1. Enabled Netlify Identity for project `cvlon`.
2. Changed registration to `Invite only`; email confirmation remains required.
3. Enabled the default Netlify Google external provider.
4. Invited only `david@cvlon.com` and `hakannex@gmail.com`.
5. Did not enable GitHub, GitLab, Bitbucket, domain rules, public registration, or Git Gateway.

Netlify Identity membership is authentication only. It is not application authorization.

## Exact bootstrap policy

The server-only environment variable is:

`PRICE_CHECK_BOOTSTRAP_ADMIN_EMAILS=david@cvlon.com,hakannex@gmail.com`

It is scoped to the Phase 4 preview branch and is never exposed through a `NEXT_PUBLIC_` variable. Exact normalized email comparison is used only for the first verified binding. `hakan@shipnex.com`, other `@cvlon.com` accounts, other Gmail accounts, and domain matches are denied.

## Issuer and subject binding

Netlify calls the deployed Identity lifecycle function as a signed platform event. The event gate requires:

- an exact bootstrap email;
- denial of missing or wrong emails and domain-only matches at validation, signup, and login.

The application then calls `getUser()` from `@netlify/identity`, verifies the signed Netlify session, and binds the stable Netlify Identity issuer namespace plus immutable Netlify user ID to the local `admin_users` record. Netlify's server-side JWT-derived `User` does not include `confirmedAt`, and an invited user's provider metadata remains `email` even when the visible flow uses Google OAuth. Those fields are therefore not treated as authorization claims. Google remains the only configured external provider and the only login action exposed by Civilon, while application authorization remains exact-email bootstrap plus immutable issuer/subject binding and local active role.

First authorized login creates an `admin_users` row with issuer, immutable subject, normalized display email, `ADMIN`, and `active=true`. It records `ADMIN_LOGIN_BOUND` and `ADMIN_LOGIN`. Later authorization uses issuer + subject + active flag + local role. A matching email with a different subject produces a binding conflict and is never rebound automatically.

## Session and CSRF architecture

Google OAuth begins in the browser with `oauthLogin("google")`. Netlify Identity processes the provider callback and stores the signed session in its secure cookie architecture. Protected server pages and every administration API independently call `getUser()` and require issuer + immutable subject + local active flag + local role.

No bearer token is stored by Civilon in `localStorage` or application code. The callback fragment is removed before navigation. Mutation endpoints require same-origin cookies and call Netlify Identity's `verifyRequestOrigin()`; a missing `Origin` is also rejected. Responses use `private, no-store`, vary on cookies, and carry `X-Robots-Tag: noindex, nofollow, noarchive`.

## Roles

- `ANALYST`: read, self-assignment, reviewed revisions, information requests, analyst-safe transitions.
- `REVIEWER`: Phase 4 analyst abilities; result approval remains inactive.
- `ADMIN`: reviewer abilities, assignment to any active staff user, exceptional operational actions, staff-management foundation.
- `AUDITOR`: read-only.

Both initial approved identities receive `ADMIN` on first successful binding. UI visibility is not an authorization control; the same role policy is enforced server-side.

## Queue and detail architecture

`/admin/price-checks` provides status, AOG, assignee, condition, transaction, age, and bounded authorized-field search. The queue minimizes PII and never displays phone or email.

`/admin/price-checks/[internal-id]` displays triage, authorized requester contact data, immutable original submission, current reviewed revision, documentation requirements, processing state, analysis/customer-result empty states, and append-only audit history. The internal database ID is routing context, never an authorization credential; all protected reads require an authorized server session.

Admin routes never enter the sitemap. They are always noindex and no-store and have no social-preview metadata.

## Assignment

Assignment is a server-side transaction. The target must be an active local admin user. Analysts/reviewers can assign themselves; admins can assign any active bound user. No placeholder user is created before first identity binding. Each change records `PRICE_CHECK_ASSIGNED` without modifying the original submission.

## Reviewed transaction revisions

Corrections create a new immutable `price_check_revisions` version. The original `price_checks` transaction remains unchanged. Part-number corrections preserve the revised human-entered value and deterministically create a normalized value; no part relationship, supersession, interchangeability, or equivalence is inferred.

Revision validation rejects unknown fields, invalid enums, unsupported currency, invalid money/date/quantity, uncontrolled documentation codes, and missing change reason. The action records `PRICE_CHECK_REVISION_CREATED`.

## Status and information workflow

The UI derives actions from the approved status-transition policy and the authenticated local role. Phase 4 does not offer `analysis_ready`; only a future actual analysis may support that transition.

Requesting information requires a category and customer-facing clarification. It changes the request to `needs_information` atomically and records `PRICE_CHECK_INFORMATION_REQUESTED` and `PRICE_CHECK_STATUS_CHANGED`. The UI explicitly states that delivery is not enabled and does not claim an email was sent.

## Audit actions

Material actions are append-only and include `ADMIN_LOGIN_BOUND`, `ADMIN_LOGIN`, `PRICE_CHECK_ASSIGNED`, `PRICE_CHECK_STATUS_CHANGED`, `PRICE_CHECK_REVISION_CREATED`, `PRICE_CHECK_INFORMATION_REQUESTED`, `PRICE_CHECK_MARKED_SPAM`, and `PRICE_CHECK_CLOSED` when the domain transition permits them. Tokens, cookies, database URLs, credentials, and full raw payloads are excluded.

## Preview database and production isolation

All remote Phase 4 writes must use the database branch created for the Phase 4 draft PR. The new migration adds only a unique local display-email index; the established 19-table model remains unchanged. Production has no Price Check schema and must remain at zero public tables.

`NEXT_PUBLIC_PRICE_CHECK_ENABLED=true` and the server-only bootstrap list are scoped only to `codex/civilon-price-check-phase-4`. Production and the frozen release remain false/unset. The public site does not depend on Identity or the Price Check database.

## Security validation

The automated suite covers the signed Netlify Identity lifecycle gate, exact-email bootstrapping, signed subject/email session claims, immutable subject binding, binding conflict, inactive local users, RBAC, unknown-field rejection, revision immutability, deterministic normalization, transactional assignment/revision/status behavior, audit creation, CSRF/origin integration, no public analytics, no public bootstrap variable, feature gating, and production isolation.

Authenticated preview validation bound `hakannex@gmail.com` as an active local `ADMIN`, then exercised queue filtering, protected detail reads, self-assignment, an immutable reviewed revision, valid status transitions, the request-information workflow, and append-only audit history. `david@cvlon.com` remains invited and intentionally unbound until David completes the first authorized login. No placeholder identity was created for David.

Netlify Identity's signed invited-user claims do not expose the current Google OAuth method: the preview returned `provider=email` and omitted `confirmedAt` after the visible Google flow. The application therefore does not claim cryptographic Google-provider enforcement at the server boundary. Google is the only configured external provider and the only Civilon login action, while the enforceable authorization boundary is signed Netlify Identity membership, the exact two-address lifecycle gate, and immutable local issuer/subject binding. This platform limitation must be reconsidered before production administration is enabled if provider-level Google proof is mandatory.

Remote testing uses synthetic Price Check data only. Direct unauthenticated API calls must return 401, unauthorized identities must receive a generic denied state, and authenticated ADMIN users may review all Price Checks.

## Deferred capabilities

- Deterministic comparable selection and pricing range engine
- Reviewer approval and customer result generation
- Transactional customer email
- Document uploads, object storage, and malware scanning
- AI extraction or explanation
- Customer result pages and accounts
- CRM integration
- Identity rebinding and a full IAM console

## Cleanup and rollback

Do not merge Phase 4 until owner approval. To roll back preview work, close the draft PR and delete its deploy previews/database branch. Remove the Phase 4 branch-scoped environment values. Do not delete the project Identity instance while invited staff or later administration work still depends on it. Production database migration is never part of Phase 4 cleanup because production is not migrated.

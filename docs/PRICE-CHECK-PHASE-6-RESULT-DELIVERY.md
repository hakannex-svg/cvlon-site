# Civilon Price Check Phase 6 — approved result and secure delivery

## Scope and result contract

Phase 6 converts a current persisted Phase 5 analysis into a human-written, explicitly approved customer result. Calculated facts are never accepted from the browser. The server reloads the current `price_check_analyses` version, validates the Price Check relationship, evidence permissions, currency, classification, confidence, factors and deterministic digest, then derives the customer view from those persisted facts.

Customer vocabulary is limited to `BELOW OBSERVED RANGE`, `WITHIN OBSERVED RANGE`, `ABOVE OBSERVED RANGE` and `INSUFFICIENT COMPARABLE EVIDENCE`. The product does not use “significantly above,” appraisal, fair-market-value, supplier-cost or supplier-margin claims.

## Approval and versioning

Result states are `DRAFT → APPROVED → SENT`. ANALYST, REVIEWER and ADMIN may draft. Only REVIEWER and ADMIN may approve or queue delivery. The same ADMIN may perform analysis and the later, separate approval action during the small-team pilot; the actions remain separate audit events.

Saving materially changed content creates result version N+1 and supersedes the prior version. Existing access credentials are revoked. Previously sent results remain immutable history. A new analysis, changed explanation, factor visibility, range policy, classification or disclaimer version requires a new result and approval.

## Range visibility

Zero observations, one observation and `INSUFFICIENT_DATA` never display a market range. For two observations, REVIEWER/ADMIN may display the persisted deterministic low/median/high only with a visible limitation statement. No additional publishability threshold is invented. Browser input cannot alter low, median or high.

## Disclaimer and legal status

Disclaimer version `civilon-price-check-v1-pending-legal-review` is server locked. Both the result disclaimer and public privacy direction remain **PENDING FINAL LEGAL REVIEW**. Engineering validation does not represent legal approval.

## Secure access

Each result link is derived from 32 bytes (256 bits) of cryptographically secure randomness. The database stores the random derivation nonce and an HMAC-SHA-256 keyed lookup digest, never the bearer credential. `PRICE_CHECK_RESULT_TOKEN_KEY` is server-only and must contain at least 32 characters.

Tokens expire after 14 days and are revocable/reissuable. Redemption is rate limited and returns the same generic unavailable state for malformed, unknown, expired, revoked or superseded credentials. Successful redemption establishes a 30-minute, Secure, HttpOnly, SameSite=Lax cookie scoped to `/price-check/result`, then redirects to the clean URL. The signed session is scoped to one result and one token; it is not a customer account.

Private result responses use `Cache-Control: private, no-store`, `X-Robots-Tag: noindex, nofollow`, page-level noindex metadata and `Referrer-Policy: no-referrer`. Result routes are absent from navigation and sitemap and do not emit public analytics. Customers receive only approved aggregate facts, never raw observations, identities, IDs, analyst notes or provenance details.

## Transactional email

`TransactionalEmailProvider` isolates delivery from the result domain. Phase 6 uses `PostmarkTransactionalEmailProvider`, the official HTTPS Email API, multipart HTML/text, link tracking disabled and minimum necessary email content. The subject contains only the Civilon Price Check reference.

Deploy Preview uses Postmark’s documented `POSTMARK_API_TEST` server-token value. The API validates the message and returns a provider result without delivering to an inbox. Production live sending is not configured.

Approval does not call Postmark. “Send result” transactionally creates/reuses the secure credential and an idempotent `RESULT_READY` outbox row. A separate leased worker sends the message, records the provider message ID and marks the result `SENT` only after provider success. Failure leaves the result `APPROVED`, records a sanitized code and schedules exponential retry; attempt five enters `dead_letter`. Database idempotency and leases prevent repeated/concurrent workers from creating duplicate successful sends.

## Sourcing conversion

The private result’s “Get a Civilon Quote” action creates one `sourcing_opportunities` row linked to the Price Check, requester and exact result version. The unique result constraint prevents duplicate conversion. It does not submit `quick-rfq`, modify Netlify Forms or call a CRM.

## Audit and security

Controlled events include result draft creation/update, approval invalidation, approval, token issuance, delivery queued/succeeded/failed, result viewed and sourcing opportunity creation. Metadata excludes bearer credentials and confidential result contents. Admin mutations retain direct Google OIDC sessions, local RBAC and strict same-origin checks. Public result access is independently token/session scoped and cannot reach admin records.

## Preview and production isolation

Synthetic requests and observations are created only through the authenticated preview seed control. Phase 6 migrations and data apply only to the PR database branch. Production Price Check remains disabled, staging remains noindex and production retains zero public Price Check tables.

## Deferred production email work

Before live email is approved, the owner must create/approve a Postmark account and live server, choose the final Civilon sender mailbox, verify the sender/domain, configure Postmark DKIM/Return-Path records without disturbing Google Workspace MX/SPF/DKIM, store a live `POSTMARK_SERVER_TOKEN`, and complete deliverability/legal review. Phase 6 does not modify DNS, Google Workspace, Bluehost or production environment values.

## Explicitly deferred

- OpenAI, prompts, AI extraction, explanation or conclusions;
- uploads, object storage and malware scanning;
- public result history or customer accounts;
- automatic approval, confidence or delivery;
- CRM integration; and
- secure quote/invoice uploads, which remain a possible Phase 7 scope.

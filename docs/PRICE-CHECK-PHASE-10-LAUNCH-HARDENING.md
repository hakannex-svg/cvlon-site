# Civilon Price Check Phase 10 - final site integration and launch hardening

Status: draft PR validation only. This phase does not enable, deploy or migrate Price Check in production.

## Integration delivered

- `/price-check` remains strictly feature-gated. When `NEXT_PUBLIC_PRICE_CHECK_ENABLED` is not exactly `true`, the page and public entry points are absent.
- When enabled in an approved preview, Price Check is presented under Services, from the homepage after the existing services section, and from Parts/category context. Existing RFQ and AOG journeys remain primary.
- The public journey explains the human-reviewed, informational service; it does not claim an appraisal, fair-market-value determination, price guarantee, supplier-cost or margin determination, inventory, or instant result.
- Public result language remains governed by the existing `BELOW_OBSERVED_RANGE`, `WITHIN_OBSERVED_RANGE`, `ABOVE_OBSERVED_RANGE`, and `INSUFFICIENT_COMPARABLE_EVIDENCE` policy. This phase adds no “fair market” customer result.
- Privacy Policy and Terms of Use are permanent footer links and production sitemap entries. Both are marked as draft/counsel review content until approved for a public production launch.

## Legal acknowledgement

Price Check submission has two separate mandatory controls:

1. Service-processing acknowledgement.
2. Separate acknowledgement of the Privacy Policy and Terms of Use.

The second control is empty by default and is enforced by client and server validation. The server records a `price_check.legal_acknowledged` audit event with the server timestamp and the fixed privacy/terms document versions. It does not record document contents, a marketing opt-in, browser fingerprint, or a user-controlled version string.

## Analytics and consent readiness

`lib/analytics.ts` permits only event names and low-sensitivity context fields. No RFQ, document, Price Check, email, phone, part number, transaction price, aircraft tail, private-result reference or message body is sent.

Approved event vocabulary:

- `price_check_view`, `price_check_start`, `price_check_submit`
- `price_check_upload_started`, `price_check_upload_completed`
- `rfq_submit`, `contact_submit`, `aog_call_click`, `whatsapp_click`
- Public Buy/Sell funnel events defined in `lib/analytics.ts`

When the approved analytics mode and GTM identifier are configured, `AnalyticsBootstrap` sends Google's default denied consent command before loading GTM on public routes. Configured tags may send limited cookieless pings while storage is denied. Only an explicit `{ granted: true }` consent event enables analytics storage; advertising storage, advertising user data and advertising personalization remain denied. Private routes are excluded by the shared list in `lib/analytics-private-routes.ts`. Consent copy, regional scope, retention and opt-out behavior remain owner/counsel decisions.

## Non-production isolation

The Phase 10 branch is eligible only for an isolated Netlify Deploy Preview and its corresponding preview database/resources. Preview-only OpenAI extraction and explanation code permits `codex/civilon-price-check-phase-10` and continues to reject `CONTEXT=production`. Production OpenAI configuration remains unset and must not be copied from preview.

## Content and compliance audit boundaries

The release audit must scan for legacy identities/phones, unverified certifications, unsupported inventory/certification claims and banned Price Check conclusions. AOG public language must describe a target immediate initial response and availability/quote update within one hour; it must not promise a guaranteed response or delivery time. “FAA 8130-3 / EASA Form 1 where applicable” is preserved as a conditional documentation statement.

## Remaining launch gates

- Counsel approval of Privacy Policy, Terms of Use, retention schedule, jurisdiction/dispute/limitation wording and consent approach.
- Owner approval of actual GA4/GTM IDs and consent-manager implementation.
- New dedicated production resources/credentials; preview credentials and data must not be promoted.
- Controlled production database migration approval after a clean non-production rehearsal and backup/restore decision.
- Verified production OIDC, S3 malware scan tagging, Postmark sender/deliverability, OpenAI data-control review and runbook rehearsal.
- Feature flag remains false in production until every gate is expressly approved.

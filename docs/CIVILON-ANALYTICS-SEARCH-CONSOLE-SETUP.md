# Civilon analytics and Google Search Console setup

Status: readiness documentation only. No GA4, GTM, Search Console, DNS or indexing change is made by this phase.

## Analytics architecture

1. Obtain owner/counsel approval for the consent approach before configuring a public analytics identifier.
2. Create or approve the GA4 property and/or GTM container outside this repository. Public IDs may be configured only after approval; never add secrets to `NEXT_PUBLIC_*` values.
3. Set `NEXT_PUBLIC_ANALYTICS_MODE=consent-required` only in an approved environment. Leave it absent otherwise.
4. Set one of `NEXT_PUBLIC_GTM_CONTAINER_ID` or `NEXT_PUBLIC_GA4_MEASUREMENT_ID` only after the approved identifier is available.
5. Integrate the chosen consent manager so that it dispatches `civilon:analytics-consent` with `{ granted: true }` only after an eligible affirmative choice. Until then, `AnalyticsBootstrap` must not load a tag.
6. Configure only the allowlisted event vocabulary documented in `PRICE-CHECK-PHASE-10-LAUNCH-HARDENING.md`. Verify GTM variables do not scrape forms or URL query strings containing sensitive data.
7. Validate in a preview with browser network tools: no GA/GTM request before consent; allowed events only after consent; no identifiers or form data in event payloads.

## Search readiness and later Search Console sequence

The production canonical is `https://cvlon.com`. Staging and Deploy Previews remain `noindex` even though their metadata can resolve canonical URLs against the production origin.

After the production site is live and validated, the owner should:

1. Confirm `https://cvlon.com` is the canonical origin and `www.cvlon.com` redirects to it.
2. Set `NEXT_PUBLIC_ALLOW_INDEXING=true` only for the approved production deployment, redeploy, and recheck every page robots directive.
3. Verify `https://cvlon.com/robots.txt` permits intended crawling and references the canonical sitemap.
4. Verify `https://cvlon.com/sitemap.xml` contains canonical public routes, including Privacy Policy and Terms of Use, and only includes `/price-check` if that feature is deliberately enabled in production.
5. Create a Search Console Domain or URL-prefix property using the owner-controlled verification path. Do not disturb MX, Google Workspace verification, SPF, DKIM or other email records.
6. Submit the canonical sitemap and monitor index coverage, enhancements and manual-action reports.
7. Align Google Business Profile name, address, phone, website and service description with the approved Civilon site information.

## SEO and AI-search principles

- Keep crawlable production pages useful, unique and internally linked with descriptive anchors.
- Keep staging/deploy previews noindex.
- Use canonical, Open Graph, structured data, breadcrumbs and sitemap URLs only under `https://cvlon.com`.
- Keep Organization/LocalBusiness schema truthful; do not add Product, Offer, Review, Rating or inventory markup without verified facts.
- Use authentic approved imagery before public production release.
- Do not create `llms.txt`, AI-specific duplicate pages, GEO/AEO schema or keyword-variation landing pages solely for AI/search promotion.

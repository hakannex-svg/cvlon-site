# PR 4 — remaining public pages, About, and image visibility

Local review URL: `http://localhost:3010`

Changed public routes:

- `/`
- `/about-us`
- `/aircraft`
- `/aircraft/beechcraft`
- `/aircraft/cessna-citation`
- `/aircraft/bombardier`
- `/aircraft/dassault-falcon`
- `/aircraft/embraer`
- `/aog-services`
- `/buy-sell-aircraft-parts/buy`
- `/buy-sell-aircraft-parts/sell`
- `/contact-us`
- `/parts`
- `/parts/avionics-instruments`
- `/parts/wheels-brakes-landing-gear`
- `/parts/engine-airframe-accessories`
- `/price-check`
- `/quality-assurance`
- `/repair-management`
- `/price-check/result` (secure-link unavailable state)
- `/buy-sell-aircraft-parts/sell/verify` (secure-link unavailable state)
- `/buy-sell-aircraft-parts/sell/evidence` (secure-link unavailable state)
- `/buy-sell-aircraft-parts/sell/availability` (secure-link unavailable state)

Every route has a desktop first-viewport image at 1440px and a mobile first-viewport image at 390px in this folder. The homepage paperwork section also has dedicated desktop and mobile review images.

## Compliance qualifier ledger

1. About page
   - Removed the former body-level sentence “All availability is subject to confirmation.”
   - Replaced it with the approved consolidated line: “Availability, condition and documentation are confirmed per request.”
   - Added the approved model boundary once: “Civilon does not certify parts and does not determine airworthiness, regulatory approval, authenticity or fitness; supporting documentation varies by part and source.”
   - Kept worldwide coordination qualified in the facts strip: “subject to destination and compliance requirements.”
   - Removed the former stand-alone international paragraph because the approved replacement copy carries its compliance boundary in the facts strip and site footer.

2. Aircraft index
   - Moved “does not imply live inventory” out of the hero body and into one compact hero qualifier.
   - New consolidated line: “Platform coverage does not imply live inventory; availability and documentation are confirmed per request.”
   - Removed the repeated “subject to availability” wording from the additional-platforms note.

3. Aircraft manufacturer pages
   - Added the same single platform qualifier to each manufacturer hero.
   - Removed Bombardier’s repeated body sentence “Availability is confirmed for each request and does not imply stocked inventory.”
   - No platform page claims live inventory.

4. Contact page
   - Removed the unapproved one-hour availability-or-quotation target.
   - Replaced it with the approved proof point: “The AOG line and WhatsApp are monitored by a live person, 24/7/365.”
   - Moved the availability, warranty, and documentation boundary from the process paragraph into one compact qualifier below it.

5. Offer Parts and secure seller follow-up pages
   - Replaced every public occurrence of “Civilon is not obliged to buy” with the approved positive framing: “Every submission gets an internal review; offers are at Civilon’s discretion.”
   - Kept all offer, acceptance, price, availability, condition, documentation, certification, authentication, regulatory approval, airworthiness, authenticity, and fitness boundaries in place.
   - Applied the same wording to seller verification, evidence, inventory-freshness, and transactional email copy; no workflow behavior changed.

6. Price Check result
   - Renamed the seller route to “Offer Parts.”
   - Reframed the discretion sentence without removing the confirmation boundary for interest, condition, documentation, or price.

7. Homepage paperwork image
   - Replaced the full-image dark wash with a bottom-only gradient.
   - Raised the source image from reduced opacity to full opacity.
   - No compliance language changed; the part, release-document clipboard, and caption are legible on desktop and mobile.

8. Naming-only sweep
   - Replaced stale public action labels with “Request a Part” and “Offer Parts.”
   - Replaced “aircraft on ground” and “aircraft-on-ground” with AOG-specific wording.
   - Privacy and Terms required no legal-substance edits.

## Programmatic content counts

- `Submit parts`: 0 public source occurrences.
- `Buy an aircraft part`: 0 public source occurrences.
- `Request an aircraft part`: 0 public source occurrences.
- `Sell aircraft parts`: 0 public source occurrences.
- `not obliged`: 0 public source occurrences.
- `aircraft on ground`: 0 public source occurrences.
- `aircraft-on-ground`: 0 public source occurrences.
- About page occurrences of ShipNex, individual names, AS9120, ISO 9001, or ASA claims: 0.

## Verification

- Focused PR 4 content tests: 124 passed.
- Full repository suite: 974 passed, 0 failed, 0 skipped.
- ESLint: passed.
- Production build: passed.
- Browser review: all changed routes at 1440px and 390px; no horizontal overflow and no browser errors.
- Lighthouse accessibility: 100 on every distinct changed public-page template after correcting the Quick Routes qualifier contrast.
- No admin UI, API behavior, schema, scheduled function, or transaction-logic changes.

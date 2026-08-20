# PR 3 — service and funnel content review

Local review URL: `http://localhost:3003`

Changed public routes:

- `/price-check`
- `/buy-sell-aircraft-parts`
- `/buy-sell-aircraft-parts/buy`
- `/buy-sell-aircraft-parts/sell`
- `/aog-services`
- `/repair-management`
- `/parts`
- `/quality-assurance`

Every route has a full-page desktop image at 1440px and a mobile image at 390px in this folder.

## Compliance qualifier ledger

1. Homepage carryover micro-fix
   - Reworded: “Each sourcing option is confirmed for availability and the documentation supplied with it.”
   - Now: “Each option is confirmed for availability, together with the documentation supplied with it.”
   - No legal meaning was removed.

2. Price Check
   - Kept the hero limitation once: informational and human-reviewed; not an appraisal, instant result, price guarantee, or determination of supplier cost or margin.
   - Removed the repeated availability/documentation caveat from the Request a Part adjacent-path card.
   - Added one compact qualifier below both adjacent-path cards covering availability, condition, documentation, delivery, price, and documentation variability.
   - Kept the seller-discretion statement in the Offer Parts card.

3. Request or Offer Aircraft Parts hub
   - Rephrased the hero caveat from “remain subject to confirmation” to a single positive confirmation line; it still covers availability, condition, documentation, delivery, price, and document variability.
   - Removed the repeated document disclaimer from card 03.
   - Added one compact qualifier after the context cards: documentation varies by part and source; Civilon identifies available records and does not certify parts or approve airworthiness.

4. Request a Part
   - Consolidated the hero caveat into one line covering privacy, availability, condition, documentation, delivery, price, and document variability.
   - Replaced repeated disclaimer bullets in the shared sourcing panel with operational proof points; the panel now has one compact qualifier line.
   - The form’s existing final operational/legal note remains unchanged in substance.

5. Offer Parts
   - Removed the duplicate “Before you start” disclaimer beside the form.
   - Kept one form-owned final note stating Civilon’s discretion, confirmation requirements, document variability, and the limits of Civilon review/evidence.
   - The success state keeps its own qualifier because it replaces, rather than appears beside, the intake form.

6. AOG support
   - Moved the approved proof point to the lead: “The AOG line is answered by a live person, 24/7/365.”
   - Kept the shipping limitation once: Civilon does not guarantee a shipping method or arrival time.
   - No response-time promise was added.

7. Repair management
   - Replaced the noun-stack introduction with an active-voice service statement.
   - Added one hero qualifier separating the third-party facility’s physical work from Civilon’s commercial, documentation, and logistics coordination.
   - Retained “appropriately approved repair facilities where required.”

8. Parts sourcing
   - Consolidated the hero caveat into one line: nothing is publicly listed; availability and documentation are confirmed per request.
   - Removed repeated source/document caveats from the sourcing body.
   - Added one compact sourcing qualifier: documentation varies by part and source; Civilon confirms source, condition, and available records with each quotation.
   - Warranty variability remains stated once in the workflow section.

9. Quality assurance
   - Added one hero qualifier: Civilon review does not certify parts, approve airworthiness, or guarantee authenticity or fitness.
   - Consolidated identity, trace, removal, test, evaluation, and warranty variability into one qualifier after the identity/condition section.
   - Removed repeated “where applicable” wording from every document-list item.
   - Added one compact document qualifier covering applicability, availability, source, condition, destination, and requirements.

## Verification

- Focused content/funnel tests: 91 passed.
- Full repository suite: 964 passed, 0 failed, 0 skipped.
- ESLint: passed.
- Production build: passed.
- Browser review: all eight routes at 1440px and 390px; no horizontal overflow; Civilon Geist loaded.
- WCAG axe scan: zero WCAG 2 A/AA or 2.1 A/AA violations on all eight routes after correcting primary-button text contrast.
- No admin, API, schema, scheduled-function, email-template, or transaction-logic changes.
- No image slots changed in this content PR; `[HAKAN-PHOTO]` review is deferred to PR 5.

# Civilon paid-search corrective gate

Status: campaigns paused. No payment or campaign activation is part of this work.

## Changes completed in the Google accounts

- All three Civilon Search campaigns are paused at campaign level.
- The verified `cvlon.com` Search Console property is linked to the Civilon GA4 web stream.
- The GTM safe public-event trigger includes the public Price Check, RFQ, Buy Request and Offer Parts funnel events. Private result, verification, offer, seller-evidence, inventory-freshness and administration routes remain excluded.

## Required proof before any paid restart

1. Deploy the denied-by-default consent-mode repair after owner approval and privacy review.
2. Run one clearly marked test submission on each paid landing path: Parts Sourcing RFQ, Price Check and AOG RFQ.
3. Confirm the matching event in GTM preview/Tag Assistant, GA4 Realtime/DebugView and the correct Google Ads conversion action without duplicate events.
4. Reconcile each test event to its Civilon admin request and reference. A browser event alone is not proof of a business lead.
5. Leave Search Partners off. Do not use broad match in the restart pilot.

Go only when all three test submissions reconcile end to end and Google Ads no longer reports the selected primary actions as misconfigured. Otherwise, remain paused.

## Paused-account copy correction

Replace the AOG ad's unsupported response-time statement before any restart. Approved direction:

- Headlines: `24/7 AOG Parts Desk`, `Business Aircraft AOG`, `Urgent Aircraft Parts`, `One Accountable Desk`, `Call Civilon's AOG Desk`.
- Descriptions: `The AOG line is answered by a live person, 24/7/365. Send the aircraft and part details.` and `One Civilon desk coordinates sourcing, paperwork and delivery for urgent requirements.`
- Qualifier: `Availability and documentation are confirmed per request.`

Nothing in the ad may claim that Civilon certifies a part, approves airworthiness, guarantees authenticity or fitness, guarantees availability, or promises a response, quotation or delivery time.

## Conservative negative-keyword starter set

Apply as phrase negatives unless a later reviewed search-term report supports a narrower exact negative:

- `aircraft salvage`, `airplane salvage`, `military aircraft parts`, `warbird parts`
- `piston engine`, `aircraft engine for sale`, `airplane engine for sale`, `propeller for sale`
- `model aircraft`, `rc aircraft`, `toy airplane`, `aviation art`
- `jobs`, `career`, `salary`, `training course`, `free pdf`

Do not add a blanket negative for `engine`, `hardware`, `manual`, `repair`, or an aircraft manufacturer; those can occur in legitimate business-aircraft requirements.

## Restart pilot structure

- Keep Parts Sourcing, Price Check and AOG in separate campaigns and separate conversion goal sets.
- Use exact and tightly controlled phrase match only.
- Keep the United States as the initial location and use presence targeting, not interest-in-location targeting.
- Start with a capped traffic-learning bid strategy only after conversion proof. Move to conversion bidding only after enough verified, non-test leads exist to support it.
- Review search terms and admin-lead reconciliation every business day during the pilot. Stop a campaign if spend resumes without verified leads or if irrelevant search terms dominate.


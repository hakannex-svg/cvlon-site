# Quick Routes, favicon, and public form feedback review

## Scope

- Rebuilds the homepage Quick Routes card from the supplied reference using Civilon's existing tokens and self-hosted Geist fonts.
- Installs the supplied Civilon favicon set and web manifest.
- Focuses and scrolls to success confirmations and failure summaries on Request a Part, Offer Parts, Price Check, and the legacy service RFQ form.
- Makes reduced-motion feedback scrolling immediate.

No admin workflow, transaction contract, API route, schema, scheduled function, or email template changed.

## Local browser verification

- Desktop: 1440 px wide, no horizontal overflow, three bordered routes, matching chips and filled buttons.
- Mobile: 390 px wide, no horizontal overflow, route buttons stack at full width.
- Civilon Geist reports loaded.
- Request a Part, Offer Parts, and Price Check error summaries scroll to 16 px below the viewport edge and receive keyboard focus.
- Favicon and manifest assets return HTTP 200; the ICO contains 16, 32, and 48 px images.

## Screenshots

![Homepage desktop at 1440px](./home-desktop-1440.png)

![Quick Routes mobile at 390px](./home-mobile-390.png)

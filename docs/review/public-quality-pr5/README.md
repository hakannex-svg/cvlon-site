# PR 5 — site-wide visual-system pass

Local review URL: `http://localhost:3011`

Changed public sections:

- Homepage hero image grade.
- Parts sourcing feature image and caption overlay.
- Parts sourcing, 24/7 AOG coordination, and repair-management service icons.
- Quality/document-control image and caption overlay.
- Business-aircraft platform rows and generic silhouette glyphs.
- Shared public-section spacing and edge treatment across public pages.

This folder includes a desktop 1440px and mobile 390px review capture for every changed homepage section. The service feature and service-card grid have separate captures so the photo overlay and all three icons can be reviewed without cropping either one.

## Visual boundaries

- All service icons are inline SVG line art using `currentColor` in the existing blue-circle container.
- Platform glyphs are a single generic business-jet silhouette; no manufacturer logo or wordmark asset is used.
- Captioned imagery uses one bottom-only gradient. The shared image grade uses CSS filters and does not replace or alter source files.
- No public copy, admin interface, transaction logic, schema, email, or scheduled function changed.

## Facility-photo flags

- `[HAKAN-PHOTO]` Replace `parts-sourcing.webp` with approved Civilon facility sourcing/inspection photography when available.
- `[HAKAN-PHOTO]` Replace the `quality-inspection` image set with approved Civilon document-control or inspection photography when available.
- `[HAKAN-PHOTO]` Replace `hero-aircraft.webp` only if Civilon commissions a rights-cleared, on-brand aircraft/facility hero image.

## Local verification

- Focused PR 5 visual-system tests: passed.
- ESLint: passed.
- Production build: passed.
- Lighthouse accessibility: 100.
- Lighthouse cumulative layout shift: 0.
- Browser review: 1440px and 390px; no visible horizontal overflow.

# Public quality PR 1 evidence

This folder records the visual review evidence for the shared public header and
font-pipeline bug fixes.

- `desktop-1440-mid-transition.jpg` captures the ticker during its opacity
  transition. Scripted inspection at capture time found one partially visible
  phrase (`0.709373`) and three fully hidden phrases (`0`).
- `mobile-390.jpg` is the initial 390 px homepage verification.
- `pages/desktop` contains a 1440 x 900 first-viewport capture for every public
  route affected by the shared header and font changes.
- `pages/mobile` contains the matching 390 x 844 captures.

The Price Check and Buy/Sell feature flags were enabled only in the local review
environment so their public pages could be captured. No production setting was
changed.

Font verification:

- Development: both font requests returned HTTP 200; `document.fonts.check()`
  returned `true` for Civilon Geist and Civilon Geist Mono.
- Production build: both preload URLs and both static font files returned HTTP
  200 from the built server assets.
- Lighthouse accessibility (desktop homepage): 100.

Compliance qualifier inventory: none moved, removed, rewritten, or duplicated
in this PR. The four ticker messages are unchanged.

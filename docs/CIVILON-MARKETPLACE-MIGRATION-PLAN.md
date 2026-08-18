# Civilon marketplace migration plan (Buy / Sell intake schema)

Status: **production migration and staged Buy/Sell launch completed and verified.**

The production migration was explicitly authorized and applied on 2026-08-18 to
the target recorded in section 5. Buy and Sell were then activated separately,
with production smoke, email, verification and signed-in admin evidence captured
before both public flags were left on.

This plan operates under the temporary manual-migration mode described in
`docs/NETLIFY-MANUAL-MIGRATIONS.md`: migration history lives in
`db/price-check/migrations-netlify-archive`, outside `netlify/database/migrations`,
and Netlify does not detect, execute, or validate these files during an
application deploy.

---

## 1. The migration

| Item | Value |
| --- | --- |
| Directory | `db/price-check/migrations-netlify-archive/20260818023551_charming_cable` |
| Position | Migration **9 of 9** (the original eight are unchanged) |
| Generator | `npm run db:price-check:generate` (drizzle-kit 1.0.0-beta.22, `drizzle.price-check.config.ts`) |
| Source of truth | `db/price-check/schema.ts` (append-only marketplace section) |

### Digests

```
migration.sql   sha256  ed4290b703e1c1e7977ff5d1315be272feaee58089e4730de69cbdbc06d66b04   (33,771 bytes)
snapshot.json   sha256  e36deb362fab59c582d463b95f1d72691d64224d240a6d9d8f0d0f3818f11f16   (296,473 bytes)
```

Re-verify before any authorized apply:

```bash
sha256sum db/price-check/migrations-netlify-archive/20260818023551_charming_cable/migration.sql \
          db/price-check/migrations-netlify-archive/20260818023551_charming_cable/snapshot.json
```

If either digest differs from the values above, **stop**: the artifact under
review is not the artifact that was rehearsed.

### The original eight are untouched

```
20260816023840_chemical_arclight   13ce18da1a81cad4…
20260816030214_nappy_silverclaw    2473459097591eea…
20260816035953_organic_ulik        94ceb74935e6afe7…
20260816061236_blue_devos          1c84e3bed3212f24…
20260816064117_faulty_flatman      85bc24b2b0514e3b…
20260816131100_melodic_landau      4f9b3afe53077cc1…
20260816161439_mean_morg           16d1644f593eb2ea…
20260816205107_young_mole_man      41534ba5a407f205…
```

No `_journal.json` was created, `netlify/database/migrations` was not recreated,
and no existing migration file was edited.

---

## 2. What the migration contains

97 statements, all additive, creating **19 new enum types** and **11 new tables**
with their indexes and constraints.

| Operation | Count | Targets |
| --- | --- | --- |
| `CREATE TYPE` | 19 | New marketplace enums only |
| `CREATE TABLE` | 11 | New marketplace tables only |
| `CREATE INDEX` | 30 | New marketplace tables only |
| `CREATE UNIQUE INDEX` | 11 | New marketplace tables only |
| `ALTER TABLE … ADD CONSTRAINT … FOREIGN KEY` | 26 | New marketplace tables only |

`ALTER TABLE … ADD CONSTRAINT` is how drizzle-kit emits every foreign key,
including in the original migration 1. **Every one of the 26 `ALTER` targets is a
newly created marketplace table.** No `ALTER` touches an existing Price Check,
admin, audit, or outbox table, and no `ALTER TYPE` appears at all.

Confirmed absent from the generated SQL: `DROP`, `RENAME`, `TRUNCATE`,
`ALTER TYPE`, `ALTER COLUMN`, and any DML (`INSERT` / `UPDATE` / `DELETE` / `MERGE`).

### New tables

`marketplace_contacts`, `buy_requests`, `sell_submissions`,
`sell_submission_items`, `email_verification_tokens`,
`marketplace_upload_sessions`, `marketplace_pending_uploads`,
`marketplace_attachments`, `marketplace_notes`, `supplier_responses`,
`buyer_offers`.

### Foreign keys pointing into existing tables

These add a dependency edge from a *new* table to an *existing* one. They do not
modify the existing table's definition.

| New table | References | On delete |
| --- | --- | --- |
| `buy_requests` | `admin_users` | `SET NULL` |
| `buy_requests` | `price_checks` | **`RESTRICT`** |
| `buy_requests` | `price_check_results` | **`RESTRICT`** |
| `sell_submissions` | `admin_users` | `SET NULL` |
| `supplier_responses` | `admin_users` | `SET NULL` |
| `buyer_offers` | `admin_users` | `SET NULL` |
| `marketplace_notes` | `admin_users` | `RESTRICT` |

The two Price Check links are `RESTRICT` because they are immutable provenance:
once a Buy Request cites a Price Check result, the citation cannot be silently
blanked and the cited row cannot be deleted out from under it.

`audit_events` and `notification_outbox` are reused as-is — both keep `varchar`
aggregate/message columns, so marketplace rows need no schema change and no
duplicate audit or outbox table was created.

---

## 3. Local rehearsal on disposable Postgres

Every integration suite provisions a throwaway Postgres via
`@netlify/database-dev` and applies the archive from empty. Nothing below
connects to a preview or production database.

```bash
# Full marketplace schema proof (8 tests)
node --test tests/marketplace-schema.integration.test.mjs

# Schema-shape proof, no database required (20 tests)
node --test tests/marketplace-schema.unit.test.mjs

# Price Check regression across the same 9-migration archive
node --test tests/price-check-phase-2.integration.test.mjs \
             tests/price-check-phase-3.integration.test.mjs \
             tests/price-check-phase-4.integration.test.mjs \
             tests/price-check-phase-5.integration.test.mjs \
             tests/price-check-phase-6.integration.test.mjs \
             tests/price-check-phase-7.integration.test.mjs \
             tests/price-check-phase-9.integration.test.mjs
```

Migration counts are derived from the archive directory by
`tests/helpers/migration-archive.mjs`, which floors the expectation at nine, so a
truncated archive fails loudly instead of trivially passing.

### What the rehearsal proves

- All 9 migrations apply cleanly from an empty database.
- All 11 marketplace tables and all 7 sampled Price Check baseline tables exist afterwards.
- Representative contact / `BR-` / `SS-` / supplier-response / buyer-offer rows persist.
- Optional seller price and quote-on-request behave; bulk inventory mode carries no single part.
- A nonregistered supplier persists as a name snapshot with no contact row.
- Invalid rows are refused: bad reference format, missing part-and-description, non-positive quantity, unknown contact FK, duplicate idempotency hash, bulk-mode violation, priced-but-not-quote-on-request, negative money.
- `buyer_offers` has no supplier cost column, no supplier identity column, and no FK path to `marketplace_contacts`; duplicate offer versions, negative sale price and sent-without-`sent_at` are all refused.
- `buyer_offer_delivery_option` has exactly four buyer-facing values and rejects `supplier_direct`.
- Pending-verification Buy and Sell rows stay queryable; verification is an ordinary status transition; one live verification token per `(aggregate_type, aggregate_id)`.
- No marketplace upload table has any FK into a Price Check table and vice versa; cross-claiming, namespace escape and mismatched aggregate types are all refused.
- A real Price Check submission still succeeds through `submitPriceCheck` after the migration, and `audit_events` accepts a `buy_request` row with no schema change.

---

## 4. Isolated Netlify preview database rehearsal

Completed against the isolated PR #21 preview environment before production
authorization. The nine-migration archive applied, the marketplace schema and
Price Check baseline were verified, and synthetic buyer-offer delivery passed
without exposing supplier identity or supplier cost on buyer-facing surfaces.
Preview credentials and data were not reused in production.

---

## 5. Production apply evidence (completed 2026-08-18)

| Evidence | Result |
| --- | --- |
| Netlify site | `cvlon`, site ID `686dfff8-0c61-4d95-8e0f-6cc5ee03fa1e` |
| Database target | `ep-blue-wind-ax2hag85.c-4.us-east-2.db.netlify.com:5432/netlifydb` |
| Baseline | 22 public tables and 8 applied historical migrations |
| Restore point | Automatic production-publish backup `snap-long-moon-ax4m69b2`, created `2026-08-18T13:07:37Z` |
| Applied artifact | `20260818023551_charming_cable`, SHA256 `ed4290b703e1c1e7977ff5d1315be272feaee58089e4730de69cbdbc06d66b04` |
| Transaction result | 97 statements committed atomically under an advisory transaction lock |
| Post-apply inventory | 33 public tables total; 11 marketplace tables; 19 marketplace enum types |
| Regression guard | Existing-table column signature unchanged |
| Public flags during apply | `NEXT_PUBLIC_MARKETPLACE_ENABLED=false`; `NEXT_PUBLIC_SELL_SUBMISSIONS_ENABLED=false` |
| Public flags after staged launch | `NEXT_PUBLIC_MARKETPLACE_ENABLED=true`; `NEXT_PUBLIC_SELL_SUBMISSIONS_ENABLED=true` |

The guarded runner in `scripts/apply-marketplace-production-migration.mjs`
bound the operation to the exact host, port, database, and owner role above;
verified the artifact digest and additive statement inventory; refused partial
or repeated application; and verified the post-commit schema inventory.

Netlify personal-access-token write access was enabled only for the apply and
was disabled immediately afterward. A post-apply check confirmed the external
CLI role had returned to `netlifydb_readonly`.

The production Postmark server was renamed `Civilon Parts Production`. Exposed
and stale server tokens were revoked, one replacement token remains, and direct
API sends returned HTTP 200 / Postmark `ErrorCode: 0` for the marketplace sender
and all three configured internal recipients: `sales@cvlon.com`,
`hakan@shipnex.com`, and `david@cvlon.com`.

### Staged production activation evidence

| Stage | Evidence |
| --- | --- |
| Secrets active, routes off | Production deploy `6a8464c0a90016000853998e` was ready on merge commit `8983858c062d53464c835bb8612eef70e2e8692e`; homepage, Price Check and admin returned 200 while marketplace routes returned 404 |
| Buy only | Production deploy `6a8467adacf6a850e4e65512` was ready with Buy on and Sell off; five consecutive probes returned 200 for homepage, Price Check, admin, hub and Buy, while Sell returned 404 |
| Buy journey | Synthetic request `BR-BHR2FQXA8P` returned 201, sent the customer verification message, verified through the public fragment-token page, appeared in the signed-in admin panel, sent the internal notice to all three recipients, and was closed |
| Buy and Sell | Production deploy `6a8468d43e066c5d291032ad` was ready with both flags on; three consecutive probes returned 200 for homepage, Price Check, admin, hub, Buy and Sell |
| Sell journey | Synthetic submission `SS-N44NYX9Q5H` returned 201 without an attachment, sent the customer verification message, verified through the public fragment-token page, appeared in the signed-in admin panel, sent the internal notice to all three recipients, and was closed |

The first Buy activation produced one isolated homepage 500 during the rollout.
The Buy flag was immediately disabled and the healthy site restored. Netlify
recorded no application error, the flag-on local production build and rendered
homepage tests passed, and the response did not recur in five consecutive Buy
probes or the later full-launch probes. Keep this as a monitored rollout anomaly;
the route flags remain the immediate rollback control if it recurs.

---

## 6. Internal review additive release (completed 2026-08-18)

PR #24 added private, staff-only business and seller-evidence review controls.
It did not change public intake fields, expose a score or badge, or represent
certification, airworthiness approval, regulatory approval, authenticity or
fitness. E-mail verification remains a separate customer-contact fact.

| Evidence | Result |
| --- | --- |
| Merge | PR #24; merge commit `c88323c52945574a6e07fefce21f9c8603df8c5c` |
| Production deploy | Netlify deploy `6a847b38aba2560008a333dc`, published from the exact merge commit at `2026-08-18T15:33:50.079Z` |
| Restore point | Netlify created the automatic production-publish backup for deploy `6a847b38aba2560008a333dc` |
| Applied artifact | `20260818120000_internal_review_layer`, SHA256 `8218a65a0a7b7967b726e192a0e728c2b813b93b000e2473d322f2e126e54145` |
| Read-only preflight | Exact production host/database confirmed; 9 statements; 0 review objects present; safe to apply |
| Transaction result | 9 statements committed atomically under an advisory transaction lock |
| Post-apply inventory | `internal_review_state` with 3 approved labels; 6 review columns; 2 reviewer foreign keys |
| Read-only verification | All 9 expected objects present; artifact already applied; no partial state |
| Public smoke | Homepage, Price Check, marketplace hub, Buy and Sell each returned HTTP 200 |

The guarded runner is
`scripts/apply-internal-review-production-migration.mjs`. It binds preflight and
apply to the approved production host, port and database; permits only the
read-only or owner role as appropriate; verifies the artifact digest and
statement count; refuses a partial or repeated apply; and confirms the enum,
column and foreign-key inventory before commit. Connection strings were copied
from Netlify's production branch, held only for the running command, then
cleared from the clipboard and process environment.

The live admin smoke used only the previously approved, closed synthetic
records `BR-BACNB6V4FR` and `SS-FMRB89WT4S`:

- Buy business review persisted `Reviewed`, displayed the staff reviewer and
  review time, added an audit event, and reset to `Not reviewed` with reviewer
  metadata cleared.
- Seller business review passed the same transition and reset.
- The clean synthetic CSV evidence moved from `Supplied — not reviewed` to
  `Reviewed`, displayed reviewer/time, updated its category summary, added an
  audit event, and reset to `Supplied — not reviewed` with reviewer metadata
  cleared.
- Contact e-mail verification remained `VERIFIED`. No customer or supplier was
  contacted and no purchase, payment, shipment or new public submission was
  created.

### Deployment-order observation

Netlify continuous deployment published the merge automatically before the
manual migration was applied. The deviation was detected from the production
database dashboard, the new production backup was confirmed, and the additive
migration was applied immediately. Future schema-bearing releases should pause
automatic publishing or use a two-release backward-compatible rollout so the
production migration is complete before code begins reading new columns.

---

## 7. Seller evidence follow-up release (completed 2026-08-18)

PR #30 added the account-free seller evidence follow-up flow. Staff can request
warehouse or business evidence, part or condition photos, part-number or serial
photos, supporting documentation, or an inventory list. Files remain private,
reuse the existing scan and secure-download controls, and arrive as `Not
reviewed` for an authorized staff member to mark `Reviewed` or `Concern`.

| Evidence | Result |
| --- | --- |
| Merge | PR #30; merge commit `9b2ff271f5112c22fa69b9ee70d41c037ffc6069` |
| Production deploy | Netlify deploy `6a84ac591699ab0008cf1db1`, published from the exact merge commit |
| Restore point | Automatic production-publish backup created for the deploy before migration |
| Applied artifact | `20260818181459_seller_evidence_requests`, SHA256 `4932b7c8439249de8e0a8c7b845b60e05834853520d68c3dfc11c47614883baf` |
| Read-only preflight | Exact production host/database confirmed; 8 statements; 0 objects present; safe to apply |
| Transaction result | 8 statements committed atomically under an advisory transaction lock |
| Post-apply inventory | 1 empty table; 16 columns; 5 indexes; 23 PostgreSQL catalog constraints |
| Read-only verification | 45 expected schema objects present; artifact already applied; table empty |
| Live smoke | Homepage, marketplace hub, Sell, account-free evidence page, and admin Sell list returned HTTP 200; an invalid credential received the generic unavailable response |
| Signed-in admin smoke | Existing closed synthetic submission loaded the new panel, existing evidence, and `Not reviewed / Reviewed / Concern` control without changing any record |

The guarded runner is
`scripts/apply-seller-evidence-production-migration.mjs`. It binds preflight and
apply to the approved production host, port and database; checks the exact
migration digest and additive statement count; requires the owner role and an
explicit apply flag for writes; refuses partial or repeated application; and
verifies the exact table, column, index, constraint and row inventory before
commit. Connection strings were passed directly from Netlify's masked controls
to the running command, were not printed or stored, and the clipboard was
cleared after every use.

Two initial apply attempts stopped inside the transaction because the runner's
post-apply catalog expectations were stricter than the production PostgreSQL
catalog format. Both transactions rolled back. A read-only preflight confirmed
zero objects after each stop before the corrected runner was retried.

This evidence workflow remains an internal review aid. Requesting, uploading or
reviewing files does not certify or authenticate a part, approve airworthiness,
constitute regulatory or supplier approval, or guarantee authenticity or
fitness. Documentation varies by part and source, and availability remains
subject to confirmation.

---

## 8. Rollback

The migration is purely additive, so the failure modes are narrow.

- **Failure mid-apply.** Stop. Preserve all logs. Do not hand-edit migration
  metadata and do not point application traffic at a partial schema. Use the
  approved Netlify database recovery/restore procedure. Any rollback must have
  been tested in non-production first.
- **Applied cleanly, but the decision is reversed.** Leave the schema in place
  and keep the feature flag off. The new tables are unreferenced by any shipped
  code path while the flag is false, and they hold no data. A cosmetic
  "undo" migration that drops the marketplace objects is **not** authorized by
  this document and would be destructive; it would need its own plan and its own
  authorization.
- **Never** delete or edit Netlify migration metadata as a shortcut.

---

## 9. Remaining limitations

- A successful Postmark API acceptance proves the message entered Postmark's
  delivery pipeline; recipient mailbox placement remains outside application
  control and must be monitored in Postmark activity.
- The marketplace production tables are intentionally retained if a public
  feature flag is turned off; rollback is flag-based, not destructive DDL.
- The guarded runner refuses a replay after marketplace objects exist. It does
  not write to or reinterpret Netlify's migration ledger.

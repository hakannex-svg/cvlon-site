# Civilon marketplace migration plan (Buy / Sell intake schema)

Status: **preparation and local rehearsal only.**

> **This document does not authorize production migration, production deployment,
> or marketplace feature enablement.** It describes an approval-ready artifact and
> the rehearsal evidence behind it. Applying this migration to the production
> database requires a separate, explicit, written authorization that names the
> exact production database and the migration SHA256 recorded below.

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

## 4. Isolated Netlify preview database procedure (not yet performed)

**Not performed in this pass.** Requires Netlify access that is out of scope here.

1. Provision or select a Netlify database branch that is **dedicated to this
   rehearsal**. Never the production branch. Confirm the connection string does
   not resolve to production before running anything.
2. Confirm the branch is empty, or is a restorable clone whose restore point has
   been recorded.
3. Apply the archive in lexical order, migration 1 through 9, capturing full
   output to a file.
4. Verify the resulting schema inventory: expected table count, all 19 new enum
   types, all constraints and indexes present, and the original Price Check
   objects structurally unchanged.
5. Re-run the archive to confirm replay behaves as expected for this mode.
6. Run synthetic Buy and Sell journeys against the preview, then confirm no
   supplier identity or supplier cost is reachable from any buyer-facing surface.
7. Destroy the preview data. Per `docs/PRICE-CHECK-PRODUCTION-RUNBOOK.md`,
   preview data and preview credentials must never be reused in production.

---

## 5. Production preflight (blocked pending authorization)

Do not begin until all of the following are true.

1. A separate written authorization exists naming the exact production database
   and the `migration.sql` SHA256 recorded in section 1.
2. The digests in section 1 re-verify against the working tree.
3. The production schema state is confirmed to match the original eight
   migrations. Section 11 of the Phase 1 review flags that the production branch
   may predate the archiving commit — **resolve which branch and SHA production
   actually serves before treating this plan as accurate.**
4. A current backup and a rehearsed restore point exist, with a named owner.
5. `NEXT_PUBLIC_MARKETPLACE_ENABLED` is **false** in production and stays false
   until the schema is confirmed present. Schema application and feature
   enablement are two separate, separately authorized events.
6. The migration is applied **out-of-band, before** any application deploy, per
   `docs/NETLIFY-MANUAL-MIGRATIONS.md`.

### Ordering

1. Backup / restore point confirmed.
2. Apply migration 9 out-of-band. Capture full output.
3. Verify schema inventory against the preview rehearsal result.
4. Deploy the application with the marketplace flag still off.
5. Enable the marketplace flag only under its own separate authorization.

---

## 6. Rollback

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

## 7. Limitations of this plan

- No production or preview database was contacted. All evidence is from
  disposable local Postgres.
- Preview rehearsal (section 4) has not been performed.
- The production schema baseline is asserted from repository history, not
  observed. See preflight item 3.
- Idempotent re-run behaviour was verified only against the local disposable
  database, not against Netlify's migration ledger.

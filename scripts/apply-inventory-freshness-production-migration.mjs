import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/netlify-db";

import * as schema from "../db/price-check/schema.ts";

/**
 * Applies the bulk-inventory freshness migration to the approved production
 * database, and refuses to do anything else.
 *
 * Dry run by default. Without `--apply` this connects, reads the catalog, prints
 * what it found and changes nothing at all — so the safe invocation is the one
 * you get by forgetting a flag, rather than the one you get by remembering it.
 *
 * The migration itself is purely additive: one enum type and one new table. It
 * alters no existing table, adds no column to `sell_submissions`, and touches no
 * stored row, which is why the destructive-statement scan below can be an
 * absolute refusal rather than a warning.
 */

const MIGRATION_NAME = "20260818200850_inventory_freshness_checks";
const EXPECTED_SHA256 = "2dedad08edf6879ed7ded63e698224b52317e24d0f8d7b4b3ba29d2bdfc09741";
const EXPECTED_STATEMENT_COUNT = 9;
const TABLE_NAME = "sell_inventory_freshness_checks";
const ENUM_NAME = "sell_inventory_freshness_response";
const EXPECTED_PRODUCTION = Object.freeze({
  hostname: "ep-blue-wind-ax2hag85.c-4.us-east-2.db.netlify.com",
  port: "5432",
  database: "netlifydb",
});

/**
 * Every column, its nullability and its stored type, in ordinal order.
 *
 * Nullability is asserted here rather than through the catalogued
 * `<column>_not_null` constraint names the seller-evidence guard lists, because
 * those names only exist on PostgreSQL 17 and later: a guard that compared them
 * as a hard list would pass or fail on the server's version rather than on the
 * schema. `information_schema` answers the same question on every version.
 */
const EXPECTED_COLUMNS = Object.freeze([
  "id:NO:varchar",
  "sell_submission_id:NO:varchar",
  "contact_id:NO:varchar",
  "keyed_token_hash:NO:varchar",
  "token_derivation_nonce:NO:varchar",
  "requested_by_admin_user_id:YES:varchar",
  "issued_at:NO:timestamptz",
  "expires_at:NO:timestamptz",
  "responded_at:YES:timestamptz",
  "revoked_at:YES:timestamptz",
  `response:YES:${ENUM_NAME}`,
  "attempt_count:NO:int4",
  "max_attempt_count:NO:int4",
  "created_at:NO:timestamptz",
  "updated_at:NO:timestamptz",
]);
const EXPECTED_INDEXES = Object.freeze([
  "sell_inventory_freshness_checks_active_uidx",
  "sell_inventory_freshness_checks_expiry_idx",
  "sell_inventory_freshness_checks_hash_uidx",
  "sell_inventory_freshness_checks_pkey",
  "sell_inventory_freshness_checks_submission_idx",
]);
/**
 * Named primary key, foreign key and check constraints, exactly as the migration
 * writes them. Auto-catalogued NOT NULL entries are excluded for the reason
 * given above and are asserted through `EXPECTED_COLUMNS` instead.
 */
const EXPECTED_CONSTRAINTS = Object.freeze([
  "sell_inventory_freshness_checks_9rwurUo46ISM_fkey",
  "sell_inventory_freshness_checks_attempt_chk",
  "sell_inventory_freshness_checks_expiry_chk",
  "sell_inventory_freshness_checks_lifecycle_chk",
  "sell_inventory_freshness_checks_pkey",
  "sell_inventory_freshness_checks_responded_order_chk",
  "sell_inventory_freshness_checks_response_chk",
  "sell_inventory_freshness_checks_wN71L8I2161H_fkey",
  "sell_inventory_freshness_checks_yhkbPAyKqlV4_fkey",
]);
/** The seller's three answers, in the order the enum declares them. */
const EXPECTED_ENUM_LABELS = Object.freeze([
  "all_available",
  "some_changed",
  "none_available",
]);
/**
 * Tables this migration must leave completely alone. Named explicitly so an
 * edited migration that reached for one of them fails the statement scan below
 * with a message that says which.
 */
const UNTOUCHED_TABLES = Object.freeze([
  "sell_submissions",
  "sell_submission_items",
  "marketplace_attachments",
  "marketplace_contacts",
  "marketplace_evidence_requests",
  "marketplace_pending_uploads",
  "notification_outbox",
  "audit_events",
]);

const apply = process.argv.includes("--apply");
const migrationUrl = new URL(
  `../db/price-check/migrations-netlify-archive/${MIGRATION_NAME}/migration.sql`,
  import.meta.url,
);

function stop(message) {
  throw new Error(message);
}

async function freshnessSchema(db) {
  const [tableResult, columnsResult, indexesResult, constraintsResult, enumResult] = await Promise.all([
    db.execute(sql.raw(
      `select to_regclass('public.${TABLE_NAME}')::text as table_name`,
    )),
    db.execute(sql.raw(
      `select column_name, is_nullable, udt_name
         from information_schema.columns
        where table_schema = 'public' and table_name = '${TABLE_NAME}'
        order by ordinal_position`,
    )),
    db.execute(sql.raw(
      `select indexname
         from pg_indexes
        where schemaname = 'public' and tablename = '${TABLE_NAME}'
        order by indexname`,
    )),
    // `contype <> 'n'` drops the PostgreSQL 17 catalogued NOT NULL rows, so the
    // same expected list holds on 16 and 17 alike.
    db.execute(sql.raw(
      `select conname as constraint_name, pg_get_constraintdef(pg_constraint.oid) as definition
         from pg_constraint
         join pg_class on pg_class.oid = pg_constraint.conrelid
         join pg_namespace on pg_namespace.oid = pg_class.relnamespace
        where pg_namespace.nspname = 'public'
          and pg_class.relname = '${TABLE_NAME}'
          and pg_constraint.contype <> 'n'
        order by conname`,
    )),
    db.execute(sql.raw(
      `select enumlabel
         from pg_enum
         join pg_type on pg_type.oid = pg_enum.enumtypid
         join pg_namespace on pg_namespace.oid = pg_type.typnamespace
        where pg_namespace.nspname = 'public' and pg_type.typname = '${ENUM_NAME}'
        order by enumsortorder`,
    )),
  ]);
  const tableExists = tableResult.rows[0]?.table_name === TABLE_NAME;
  const columns = columnsResult.rows.map(
    (row) => `${row.column_name}:${row.is_nullable}:${row.udt_name}`,
  );
  const indexes = indexesResult.rows.map((row) => row.indexname);
  const constraints = constraintsResult.rows.map((row) => ({
    name: row.constraint_name,
    definition: row.definition,
  }));
  const enumLabels = enumResult.rows.map((row) => row.enumlabel);
  let rowCount = null;
  if (tableExists) {
    rowCount = Number((await db.execute(sql.raw(
      `select count(*)::integer as row_count from public.${TABLE_NAME}`,
    ))).rows[0]?.row_count ?? 0);
  }
  return { tableExists, columns, indexes, constraints, enumLabels, rowCount };
}

function objectCount(evidence) {
  return Number(evidence.tableExists)
    + evidence.columns.length
    + evidence.indexes.length
    + evidence.constraints.length
    + evidence.enumLabels.length;
}

/** Every object this migration is supposed to have created, and nothing else. */
const COMPLETE_OBJECT_COUNT = 1
  + EXPECTED_COLUMNS.length
  + EXPECTED_INDEXES.length
  + EXPECTED_CONSTRAINTS.length
  + EXPECTED_ENUM_LABELS.length;

function assertComplete(evidence) {
  if (!evidence.tableExists) stop("The inventory freshness table is missing.");
  if (JSON.stringify(evidence.columns) !== JSON.stringify(EXPECTED_COLUMNS)) {
    stop(`The inventory freshness columns do not match the approved inventory: ${JSON.stringify(evidence.columns)}.`);
  }
  if (JSON.stringify(evidence.indexes) !== JSON.stringify(EXPECTED_INDEXES)) {
    stop(`The inventory freshness indexes do not match the approved inventory: ${JSON.stringify(evidence.indexes)}.`);
  }
  const constraintNames = evidence.constraints.map((entry) => entry.name);
  if (JSON.stringify(constraintNames) !== JSON.stringify(EXPECTED_CONSTRAINTS)) {
    stop(`The inventory freshness constraints do not match the approved inventory: ${JSON.stringify(constraintNames)}.`);
  }
  if (JSON.stringify(evidence.enumLabels) !== JSON.stringify(EXPECTED_ENUM_LABELS)) {
    stop(`The inventory freshness response enum does not match the approved values: ${JSON.stringify(evidence.enumLabels)}.`);
  }

  const definition = (name) =>
    evidence.constraints.find((entry) => entry.name === name)?.definition ?? "";

  // One live check per submission is the rule the whole reissue design rests on:
  // without the partial predicate this index would forbid a second check ever,
  // and without the index the reissue transaction would not be exclusive.
  const activeIndex = evidence.indexes.includes("sell_inventory_freshness_checks_active_uidx");
  if (!activeIndex) stop("The one-live-check partial unique index is missing.");

  // The answer and its timestamp must remain one fact.
  const responseChk = definition("sell_inventory_freshness_checks_response_chk").toLowerCase();
  if (!responseChk.includes("responded_at") || !responseChk.includes("response")) {
    stop("The inventory freshness response constraint no longer ties the answer to its timestamp.");
  }
  // A responded row and a revoked row are mutually exclusive states.
  const lifecycleChk = definition("sell_inventory_freshness_checks_lifecycle_chk").toLowerCase();
  if (!lifecycleChk.includes("responded_at") || !lifecycleChk.includes("revoked_at")) {
    stop("The inventory freshness lifecycle constraint no longer excludes a responded-and-revoked row.");
  }
  const attemptChk = definition("sell_inventory_freshness_checks_attempt_chk").toLowerCase();
  if (!attemptChk.includes("attempt_count") || !attemptChk.includes("max_attempt_count")) {
    stop("The inventory freshness attempt constraint no longer bounds the attempt counter.");
  }
}

if (!process.env.NETLIFY_DB_URL) stop("NETLIFY_DB_URL is required.");
if (process.env.NETLIFY_DB_DRIVER !== "server") stop("NETLIFY_DB_DRIVER must be server.");
const databaseUrl = new URL(process.env.NETLIFY_DB_URL);
if (databaseUrl.protocol !== "postgresql:") stop("The database URL must use postgresql.");
const resolvedTarget = {
  hostname: databaseUrl.hostname,
  port: databaseUrl.port || "5432",
  database: databaseUrl.pathname.replace(/^\//, ""),
  role: decodeURIComponent(databaseUrl.username),
};
for (const key of Object.keys(EXPECTED_PRODUCTION)) {
  if (resolvedTarget[key] !== EXPECTED_PRODUCTION[key]) {
    stop(`The resolved production database ${key} does not match the approved target.`);
  }
}
// A dry run is happy with the read-only role. An apply is not: writing DDL as a
// role that was handed out for reading is how a "preflight" becomes a migration.
const approvedRoles = apply ? ["netlifydb_owner"] : ["netlifydb_readonly", "netlifydb_owner"];
if (!approvedRoles.includes(resolvedTarget.role)) {
  stop("The resolved production database role is not approved for this mode.");
}

const migration = await readFile(migrationUrl, "utf8");
const digest = createHash("sha256").update(migration).digest("hex");
if (digest !== EXPECTED_SHA256) stop("The inventory freshness migration digest is not approved.");
if (/\b(?:DROP|TRUNCATE|RENAME|ALTER\s+TYPE|ALTER\s+COLUMN)\b/i.test(migration)
  || /^\s*(?:DELETE|UPDATE|INSERT)\b/im.test(migration)) {
  stop("The inventory freshness migration contains a destructive or data-changing operation.");
}
// Additive means additive: the only object any statement may name as its target
// is the new table or the new enum. Two separate patterns rather than one
// alternation, because the two statement shapes name their target differently —
// `ALTER TABLE <name>` and `CREATE INDEX … ON <name>` — and a single expression
// trying to cover both ends up matching neither. A `REFERENCES "<name>"` clause
// is deliberately not a match: pointing a new foreign key at an existing table
// is what "additive" means, and is not a modification of it.
for (const table of UNTOUCHED_TABLES) {
  const altered = new RegExp(`ALTER\\s+TABLE\\s+(?:ONLY\\s+)?"?${table}"?`, "i");
  const indexed = new RegExp(`CREATE\\s+(?:UNIQUE\\s+)?INDEX[^;]*?\\sON\\s+(?:ONLY\\s+)?"?${table}"?`, "i");
  if (altered.test(migration) || indexed.test(migration)) {
    stop(`The inventory freshness migration modifies ${table}, which must be left untouched.`);
  }
}
const statements = migration
  .split(/-->\s*statement-breakpoint\s*/)
  .map((statement) => statement.trim())
  .filter(Boolean);
if (statements.length !== EXPECTED_STATEMENT_COUNT) {
  stop(`Expected ${EXPECTED_STATEMENT_COUNT} statements, found ${statements.length}.`);
}

const db = drizzle({ schema });
try {
  const before = await freshnessSchema(db);
  if (!apply) {
    const presentCount = objectCount(before);
    // Either nothing is there, or everything is and matches. A partial schema is
    // the one state this script must never call safe.
    if (presentCount !== 0) assertComplete(before);
    console.log(JSON.stringify({
      ok: true,
      mode: "preflight",
      migration: MIGRATION_NAME,
      sha256: digest,
      statementCount: statements.length,
      objectsPresent: presentCount,
      safeToApply: presentCount === 0,
      alreadyApplied: before.tableExists && presentCount === COMPLETE_OBJECT_COUNT,
      rowCount: before.rowCount,
    }, null, 2));
  } else {
    if (process.env.CIVILON_APPLY_INVENTORY_FRESHNESS_MIGRATION !== "YES") {
      stop("CIVILON_APPLY_INVENTORY_FRESHNESS_MIGRATION=YES is required with --apply.");
    }
    if (objectCount(before) !== 0) {
      stop("Inventory freshness schema objects already exist; refusing a partial or repeated apply.");
    }
    const after = await db.transaction(async (tx) => {
      await tx.execute(sql.raw(
        `select pg_advisory_xact_lock(hashtext('civilon-${MIGRATION_NAME}'))`,
      ));
      // Re-read inside the lock. Between the preflight and here, another operator
      // could have applied it; proceeding would be a second CREATE that aborts
      // the transaction anyway, but failing on purpose says why.
      if (objectCount(await freshnessSchema(tx)) !== 0) {
        stop("Inventory freshness schema changed after preflight; refusing the apply.");
      }
      for (const statement of statements) await tx.execute(sql.raw(statement));
      const evidence = await freshnessSchema(tx);
      // Any mismatch throws, which rolls the whole transaction back: the database
      // ends up exactly as it started rather than half-migrated.
      assertComplete(evidence);
      if (evidence.rowCount !== 0) stop("The new inventory freshness table is not empty after migration.");
      return evidence;
    });
    console.log(JSON.stringify({
      ok: true,
      mode: "applied",
      migration: MIGRATION_NAME,
      sha256: digest,
      statementCount: statements.length,
      columnCount: after.columns.length,
      indexCount: after.indexes.length,
      constraintCount: after.constraints.length,
      enumLabelCount: after.enumLabels.length,
      rowCount: after.rowCount,
    }, null, 2));
  }
} finally {
  await db.$client.end();
}

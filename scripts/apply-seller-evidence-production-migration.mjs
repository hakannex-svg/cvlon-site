import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/netlify-db";

import * as schema from "../db/price-check/schema.ts";

const MIGRATION_NAME = "20260818181459_seller_evidence_requests";
const EXPECTED_SHA256 = "4932b7c8439249de8e0a8c7b845b60e05834853520d68c3dfc11c47614883baf";
const EXPECTED_STATEMENT_COUNT = 8;
const TABLE_NAME = "marketplace_evidence_requests";
const EXPECTED_PRODUCTION = Object.freeze({
  hostname: "ep-blue-wind-ax2hag85.c-4.us-east-2.db.netlify.com",
  port: "5432",
  database: "netlifydb",
});
const EXPECTED_COLUMNS = Object.freeze([
  "id",
  "sell_submission_id",
  "contact_id",
  "requested_categories",
  "keyed_token_hash",
  "token_derivation_nonce",
  "requested_by_admin_user_id",
  "issued_at",
  "expires_at",
  "consumed_at",
  "revoked_at",
  "attempt_count",
  "max_attempt_count",
  "submitted_attachment_count",
  "created_at",
  "updated_at",
]);
const EXPECTED_INDEXES = Object.freeze([
  "marketplace_evidence_requests_active_uidx",
  "marketplace_evidence_requests_expiry_idx",
  "marketplace_evidence_requests_hash_uidx",
  "marketplace_evidence_requests_pkey",
  "marketplace_evidence_requests_submission_idx",
]);
const EXPECTED_CONSTRAINTS = Object.freeze([
  "marketplace_evidence_reques_submitted_attachment_count_not_null",
  "marketplace_evidence_requests_G0Ou1yGdOCCi_fkey",
  "marketplace_evidence_requests_XcSkqv8vYtvt_fkey",
  "marketplace_evidence_requests_attempt_chk",
  "marketplace_evidence_requests_attempt_count_not_null",
  "marketplace_evidence_requests_categories_chk",
  "marketplace_evidence_requests_consumed_order_chk",
  "marketplace_evidence_requests_contact_id_not_null",
  "marketplace_evidence_requests_created_at_not_null",
  "marketplace_evidence_requests_expires_at_not_null",
  "marketplace_evidence_requests_expiry_chk",
  "marketplace_evidence_requests_id_not_null",
  "marketplace_evidence_requests_issued_at_not_null",
  "marketplace_evidence_requests_keyed_token_hash_not_null",
  "marketplace_evidence_requests_lifecycle_chk",
  "marketplace_evidence_requests_max_attempt_count_not_null",
  "marketplace_evidence_requests_nHQv7fjLEvZf_fkey",
  "marketplace_evidence_requests_pkey",
  "marketplace_evidence_requests_requested_categories_not_null",
  "marketplace_evidence_requests_sell_submission_id_not_null",
  "marketplace_evidence_requests_submitted_chk",
  "marketplace_evidence_requests_token_derivation_nonce_not_null",
  "marketplace_evidence_requests_updated_at_not_null",
]);
const apply = process.argv.includes("--apply");
const migrationUrl = new URL(
  `../db/price-check/migrations-netlify-archive/${MIGRATION_NAME}/migration.sql`,
  import.meta.url,
);

function stop(message) {
  throw new Error(message);
}

async function sellerEvidenceSchema(db) {
  const [tableResult, columnsResult, indexesResult, constraintsResult] = await Promise.all([
    db.execute(sql.raw(
      `select to_regclass('public.${TABLE_NAME}')::text as table_name`,
    )),
    db.execute(sql.raw(
      `select column_name
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
    db.execute(sql.raw(
      `select conname as constraint_name, pg_get_constraintdef(pg_constraint.oid) as definition
         from pg_constraint
         join pg_class on pg_class.oid = pg_constraint.conrelid
         join pg_namespace on pg_namespace.oid = pg_class.relnamespace
        where pg_namespace.nspname = 'public' and pg_class.relname = '${TABLE_NAME}'
        order by conname`,
    )),
  ]);
  const tableExists = tableResult.rows[0]?.table_name === TABLE_NAME;
  const columns = columnsResult.rows.map((row) => row.column_name);
  const indexes = indexesResult.rows.map((row) => row.indexname);
  const constraints = constraintsResult.rows.map((row) => ({
    name: row.constraint_name,
    definition: row.definition,
  }));
  let rowCount = null;
  if (tableExists) {
    rowCount = Number((await db.execute(sql.raw(
      `select count(*)::integer as row_count from public.${TABLE_NAME}`,
    ))).rows[0]?.row_count ?? 0);
  }
  return { tableExists, columns, indexes, constraints, rowCount };
}

function objectCount(evidence) {
  return Number(evidence.tableExists)
    + evidence.columns.length
    + evidence.indexes.length
    + evidence.constraints.length;
}

function assertComplete(evidence) {
  if (!evidence.tableExists) stop("The seller evidence request table is missing.");
  if (JSON.stringify(evidence.columns) !== JSON.stringify(EXPECTED_COLUMNS)) {
    stop(`The seller evidence columns do not match the approved inventory: ${JSON.stringify(evidence.columns)}.`);
  }
  if (JSON.stringify(evidence.indexes) !== JSON.stringify(EXPECTED_INDEXES)) {
    stop(`The seller evidence indexes do not match the approved inventory: ${JSON.stringify(evidence.indexes)}.`);
  }
  const constraintNames = evidence.constraints.map((entry) => entry.name);
  if (JSON.stringify(constraintNames) !== JSON.stringify(EXPECTED_CONSTRAINTS)) {
    stop(`The seller evidence constraints do not match the approved inventory: ${JSON.stringify(constraintNames)}.`);
  }
  const categoryConstraint = evidence.constraints.find(
    (entry) => entry.name === "marketplace_evidence_requests_categories_chk",
  )?.definition ?? "";
  if (!categoryConstraint.toLowerCase().includes("cardinality")
    || !categoryConstraint.includes("1")
    || !categoryConstraint.includes("5")) {
    stop("The seller evidence category constraint does not retain its cardinality bounds.");
  }
  for (const category of [
    "INVENTORY_SPREADSHEET",
    "WAREHOUSE_BUSINESS_EVIDENCE",
    "CUSTODY_PART_PHOTO",
    "PART_NUMBER_SERIAL_PHOTO",
    "RELEASE_SUPPORTING_DOCUMENT",
  ]) {
    if (!categoryConstraint.includes(category)) {
      stop(`The seller evidence category constraint is missing ${category}.`);
    }
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
const approvedRoles = apply ? ["netlifydb_owner"] : ["netlifydb_readonly", "netlifydb_owner"];
if (!approvedRoles.includes(resolvedTarget.role)) {
  stop("The resolved production database role is not approved for this mode.");
}

const migration = await readFile(migrationUrl, "utf8");
const digest = createHash("sha256").update(migration).digest("hex");
if (digest !== EXPECTED_SHA256) stop("The seller evidence migration digest is not approved.");
if (/\b(?:DROP|TRUNCATE|RENAME|ALTER\s+TYPE|ALTER\s+COLUMN)\b/i.test(migration)
  || /^\s*(?:DELETE|UPDATE|INSERT)\b/im.test(migration)) {
  stop("The seller evidence migration contains a destructive or data-changing operation.");
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
  const before = await sellerEvidenceSchema(db);
  if (!apply) {
    const presentCount = objectCount(before);
    if (presentCount !== 0) assertComplete(before);
    console.log(JSON.stringify({
      ok: true,
      mode: "preflight",
      migration: MIGRATION_NAME,
      sha256: digest,
      statementCount: statements.length,
      objectsPresent: presentCount,
      safeToApply: presentCount === 0,
      alreadyApplied: before.tableExists && presentCount === 45,
      rowCount: before.rowCount,
    }, null, 2));
  } else {
    if (process.env.CIVILON_APPLY_SELL_EVIDENCE_MIGRATION !== "YES") {
      stop("CIVILON_APPLY_SELL_EVIDENCE_MIGRATION=YES is required with --apply.");
    }
    if (objectCount(before) !== 0) {
      stop("Seller evidence schema objects already exist; refusing a partial or repeated apply.");
    }
    const after = await db.transaction(async (tx) => {
      await tx.execute(sql.raw(
        `select pg_advisory_xact_lock(hashtext('civilon-${MIGRATION_NAME}'))`,
      ));
      if (objectCount(await sellerEvidenceSchema(tx)) !== 0) {
        stop("Seller evidence schema changed after preflight; refusing the apply.");
      }
      for (const statement of statements) await tx.execute(sql.raw(statement));
      const evidence = await sellerEvidenceSchema(tx);
      assertComplete(evidence);
      if (evidence.rowCount !== 0) stop("The new seller evidence table is not empty after migration.");
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
      rowCount: after.rowCount,
    }, null, 2));
  }
} finally {
  await db.$client.end();
}

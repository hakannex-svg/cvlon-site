import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/netlify-db";

import * as schema from "../db/price-check/schema.ts";

const MIGRATION_NAME = "20260818120000_internal_review_layer";
const EXPECTED_SHA256 = "8218a65a0a7b7967b726e192a0e728c2b813b93b000e2473d322f2e126e54145";
const EXPECTED_STATEMENT_COUNT = 9;
const EXPECTED_PRODUCTION = Object.freeze({
  hostname: "ep-blue-wind-ax2hag85.c-4.us-east-2.db.netlify.com",
  port: "5432",
  database: "netlifydb",
});
const EXPECTED_COLUMNS = Object.freeze([
  ["marketplace_contacts", "business_review_state"],
  ["marketplace_contacts", "business_reviewed_at"],
  ["marketplace_contacts", "business_reviewed_by_admin_user_id"],
  ["marketplace_attachments", "review_state"],
  ["marketplace_attachments", "reviewed_at"],
  ["marketplace_attachments", "reviewed_by_admin_user_id"],
]);
const EXPECTED_CONSTRAINTS = Object.freeze([
  "marketplace_attachments_reviewer_fkey",
  "marketplace_contacts_business_reviewer_fkey",
]);
const apply = process.argv.includes("--apply");
const migrationUrl = new URL(
  `../db/price-check/migrations-netlify-archive/${MIGRATION_NAME}/migration.sql`,
  import.meta.url,
);

function stop(message) {
  throw new Error(message);
}

async function reviewEvidence(db) {
  const typeLabels = (await db.execute(sql.raw(
    `select enumlabel
       from pg_enum
       join pg_type on pg_type.oid = pg_enum.enumtypid
       join pg_namespace on pg_namespace.oid = pg_type.typnamespace
      where pg_namespace.nspname = 'public'
        and pg_type.typname = 'internal_review_state'
      order by enumsortorder`,
  ))).rows.map((row) => row.enumlabel);
  const columns = (await db.execute(sql.raw(
    `select table_name, column_name
       from information_schema.columns
      where table_schema = 'public'
        and (table_name, column_name) in (
          ('marketplace_contacts', 'business_review_state'),
          ('marketplace_contacts', 'business_reviewed_at'),
          ('marketplace_contacts', 'business_reviewed_by_admin_user_id'),
          ('marketplace_attachments', 'review_state'),
          ('marketplace_attachments', 'reviewed_at'),
          ('marketplace_attachments', 'reviewed_by_admin_user_id')
        )
      order by table_name, column_name`,
  ))).rows.map((row) => [row.table_name, row.column_name]);
  const constraints = (await db.execute(sql.raw(
    `select conname as constraint_name
       from pg_constraint
       join pg_class on pg_class.oid = pg_constraint.conrelid
       join pg_namespace on pg_namespace.oid = pg_class.relnamespace
      where pg_namespace.nspname = 'public'
        and conname in (
          'marketplace_attachments_reviewer_fkey',
          'marketplace_contacts_business_reviewer_fkey'
        )
      order by conname`,
  ))).rows.map((row) => row.constraint_name);
  return { typeLabels, columns, constraints };
}

function objectCount(evidence) {
  return Number(evidence.typeLabels.length > 0)
    + evidence.columns.length
    + evidence.constraints.length;
}

function assertComplete(evidence) {
  if (JSON.stringify(evidence.typeLabels) !== JSON.stringify(["not_reviewed", "reviewed", "concern"])) {
    stop("The internal review enum does not match the approved labels.");
  }
  if (JSON.stringify(evidence.columns) !== JSON.stringify([...EXPECTED_COLUMNS].sort())) {
    stop("The internal review columns do not match the approved inventory.");
  }
  if (JSON.stringify(evidence.constraints) !== JSON.stringify(EXPECTED_CONSTRAINTS)) {
    stop(`The internal review foreign keys do not match the approved inventory: ${JSON.stringify(evidence.constraints)}.`);
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
if (digest !== EXPECTED_SHA256) stop("The internal review migration digest is not approved.");
if (/\b(?:DROP|TRUNCATE|RENAME|ALTER\s+TYPE|ALTER\s+COLUMN)\b/i.test(migration)) {
  stop("The internal review migration contains a destructive or unapproved operation.");
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
  const before = await reviewEvidence(db);
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
      alreadyApplied: presentCount === 9,
    }, null, 2));
  } else {
    if (process.env.CIVILON_APPLY_INTERNAL_REVIEW_MIGRATION !== "YES") {
      stop("CIVILON_APPLY_INTERNAL_REVIEW_MIGRATION=YES is required with --apply.");
    }
    if (objectCount(before) !== 0) {
      stop("Internal review schema objects already exist; refusing a partial or repeated apply.");
    }
    const after = await db.transaction(async (tx) => {
      await tx.execute(sql.raw(
        `select pg_advisory_xact_lock(hashtext('civilon-${MIGRATION_NAME}'))`,
      ));
      if (objectCount(await reviewEvidence(tx)) !== 0) {
        stop("Internal review schema changed after preflight; refusing the apply.");
      }
      for (const statement of statements) await tx.execute(sql.raw(statement));
      const evidence = await reviewEvidence(tx);
      assertComplete(evidence);
      return evidence;
    });
    console.log(JSON.stringify({
      ok: true,
      mode: "applied",
      migration: MIGRATION_NAME,
      sha256: digest,
      statementCount: statements.length,
      enumLabels: after.typeLabels,
      columnCount: after.columns.length,
      foreignKeyCount: after.constraints.length,
    }, null, 2));
  }
} finally {
  await db.$client.end();
}

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/netlify-db";

import * as schema from "../db/price-check/schema.ts";

const MIGRATION_NAME = "20260818023551_charming_cable";
const EXPECTED_SHA256 = "ed4290b703e1c1e7977ff5d1315be272feaee58089e4730de69cbdbc06d66b04";
const EXPECTED_STATEMENT_COUNT = 97;
const EXPECTED_PRODUCTION = Object.freeze({
  hostname: "ep-blue-wind-ax2hag85.c-4.us-east-2.db.netlify.com",
  port: "5432",
  database: "netlifydb",
  role: "netlifydb_owner",
});
const apply = process.argv.includes("--apply");

const migrationUrl = new URL(
  `../db/price-check/migrations-netlify-archive/${MIGRATION_NAME}/migration.sql`,
  import.meta.url,
);

function stop(message) {
  throw new Error(message);
}

function quotedNames(source, expression) {
  return [...source.matchAll(expression)].map((match) => match[1]).sort();
}

async function publicTables(db) {
  return (await db.execute(sql.raw(
    `select table_name
       from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
      order by table_name`,
  ))).rows.map((row) => row.table_name);
}

async function baselineColumnSignature(db, marketplaceTables) {
  const rows = (await db.execute(sql.raw(
    `select table_name, column_name, ordinal_position, data_type, is_nullable
       from information_schema.columns
      where table_schema = 'public'
      order by table_name, ordinal_position`,
  ))).rows.filter((row) => !marketplaceTables.has(row.table_name));
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

async function schemaEvidence(db, expectedTables, expectedTypes) {
  const tables = await publicTables(db);
  const tableSet = new Set(tables);
  const types = (await db.execute(sql.raw(
    `select typname
       from pg_type
       join pg_namespace on pg_namespace.oid = pg_type.typnamespace
      where pg_namespace.nspname = 'public' and typtype = 'e'
      order by typname`,
  ))).rows.map((row) => row.typname);
  const typeSet = new Set(types);
  return {
    tables,
    marketplaceTablesPresent: expectedTables.filter((name) => tableSet.has(name)),
    marketplaceTypesPresent: expectedTypes.filter((name) => typeSet.has(name)),
  };
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

const migration = await readFile(migrationUrl, "utf8");
const digest = createHash("sha256").update(migration).digest("hex");
if (digest !== EXPECTED_SHA256) stop("The marketplace migration digest is not approved.");
if (/\b(?:DROP|TRUNCATE|RENAME|ALTER\s+TYPE|ALTER\s+COLUMN)\b/i.test(migration)) {
  stop("The marketplace migration contains a destructive or unapproved operation.");
}

const statements = migration
  .split(/-->\s*statement-breakpoint\s*/)
  .map((statement) => statement.trim())
  .filter(Boolean);
if (statements.length !== EXPECTED_STATEMENT_COUNT) {
  stop(`Expected ${EXPECTED_STATEMENT_COUNT} statements, found ${statements.length}.`);
}

const expectedTables = quotedNames(migration, /CREATE TABLE "([^"]+)"/g);
const expectedTypes = quotedNames(migration, /CREATE TYPE "([^"]+)"/g);
if (expectedTables.length !== 11 || expectedTypes.length !== 19) {
  stop("The marketplace migration object inventory changed.");
}
const marketplaceTableSet = new Set(expectedTables);

const db = drizzle({ schema });
try {
  const before = await schemaEvidence(db, expectedTables, expectedTypes);
  const baselineTables = before.tables.filter((name) => !marketplaceTableSet.has(name));
  const baselineSignature = await baselineColumnSignature(db, marketplaceTableSet);

  if (!apply) {
    console.log(JSON.stringify({
      ok: true,
      mode: "preflight",
      migration: MIGRATION_NAME,
      sha256: digest,
      statementCount: statements.length,
      baselineTableCount: baselineTables.length,
      marketplaceTablesPresent: before.marketplaceTablesPresent,
      marketplaceTypesPresent: before.marketplaceTypesPresent,
      safeToApply: before.marketplaceTablesPresent.length === 0
        && before.marketplaceTypesPresent.length === 0,
    }, null, 2));
    process.exitCode = 0;
  } else {
    if (process.env.CIVILON_APPLY_MARKETPLACE_MIGRATION !== "YES") {
      stop("CIVILON_APPLY_MARKETPLACE_MIGRATION=YES is required with --apply.");
    }
    if (before.marketplaceTablesPresent.length || before.marketplaceTypesPresent.length) {
      stop("Marketplace schema objects already exist; refusing a partial or repeated apply.");
    }

    const result = await db.transaction(async (tx) => {
      await tx.execute(sql.raw(
        `select pg_advisory_xact_lock(hashtext('civilon-marketplace-${MIGRATION_NAME}'))`,
      ));
      const lockedEvidence = await schemaEvidence(tx, expectedTables, expectedTypes);
      if (lockedEvidence.marketplaceTablesPresent.length || lockedEvidence.marketplaceTypesPresent.length) {
        stop("Marketplace schema changed after preflight; refusing the apply.");
      }

      for (const statement of statements) await tx.execute(sql.raw(statement));

      const after = await schemaEvidence(tx, expectedTables, expectedTypes);
      const afterBaselineSignature = await baselineColumnSignature(tx, marketplaceTableSet);
      if (after.marketplaceTablesPresent.length !== expectedTables.length) {
        stop("Not every marketplace table was created.");
      }
      if (after.marketplaceTypesPresent.length !== expectedTypes.length) {
        stop("Not every marketplace enum was created.");
      }
      if (afterBaselineSignature !== baselineSignature) {
        stop("An existing table's column signature changed.");
      }
      return after;
    });

    console.log(JSON.stringify({
      ok: true,
      mode: "applied",
      migration: MIGRATION_NAME,
      sha256: digest,
      statementCount: statements.length,
      baselineTableCount: baselineTables.length,
      marketplaceTableCount: result.marketplaceTablesPresent.length,
      marketplaceTypeCount: result.marketplaceTypesPresent.length,
      totalPublicTableCount: result.tables.length,
    }, null, 2));
  }
} finally {
  await db.$client.end();
}

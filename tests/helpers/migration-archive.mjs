import { readdirSync } from "node:fs";

/**
 * Resolves the manual-migration archive the same way the integration tests do.
 * Kept in one place so a new archived migration cannot silently invalidate a
 * hardcoded count in nine different files.
 */
export const migrationsDirectory = new URL(
  "../../db/price-check/migrations-netlify-archive/",
  import.meta.url,
).pathname.replace(/^\/(\w:)/, "$1");

/** Every archived migration directory name, in lexical (application) order. */
export function archivedMigrationDirectories() {
  return readdirSync(migrationsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/**
 * The number of migrations `applyMigrations` is expected to report. Derived
 * from the archive on disk rather than hardcoded, but floored at the nine
 * migrations that must exist (the original eight plus the marketplace
 * package) so an empty or truncated archive fails loudly instead of trivially
 * satisfying the assertion.
 */
export function expectedMigrationCount() {
  const directories = archivedMigrationDirectories();
  if (directories.length < 9) {
    throw new Error(
      `Expected at least 9 archived migrations, found ${directories.length}: ${directories.join(", ")}`,
    );
  }
  return directories.length;
}

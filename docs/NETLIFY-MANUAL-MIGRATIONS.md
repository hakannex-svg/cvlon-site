# Temporary manual migration mode

Civilon temporarily keeps its Netlify Database migration history outside
`netlify/database/migrations` because Netlify's native migration ledger is
reporting a checksum mismatch for production migrations that match the pulled
production source byte-for-byte.

Until Netlify Support resolves the native migration-state issue:

- application deploys may proceed normally when they contain no schema change;
- no new schema migration is allowed without an explicit manual migration plan;
- historical migrations remain preserved in
  `db/price-check/migrations-netlify-archive`;
- schema changes must be applied out-of-band before application deployment; and
- the owner will decide whether to restore Netlify-native migrations after the
  platform state is corrected.

This mode does not disable Netlify Database. Runtime code continues to use the
same `drizzle-orm/netlify-db` provider and production database connection. It
only prevents Netlify from automatically detecting, executing, or validating
the archived migration files during application deploys.

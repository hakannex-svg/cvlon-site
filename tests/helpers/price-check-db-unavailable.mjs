delete process.env.NETLIFY_DB_URL;
delete process.env.NETLIFY_DB_DRIVER;

const { sql } = await import("drizzle-orm");
const { priceCheckDb } = await import("../../db/price-check/index.ts");
await priceCheckDb.execute(sql`select 1`);

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/netlify-db";

const db = drizzle();
await db.execute(sql`select 1`);

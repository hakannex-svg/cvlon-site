import { drizzle } from "drizzle-orm/netlify-db";
import * as schema from "./schema.ts";

// Intentionally separate from db/index.ts, which remains the inactive D1 starter.
// The module-level client lets the serverless runtime reuse its connection pool.
export const priceCheckProbeDb = drizzle({ schema });

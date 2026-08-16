import "./server-boundary.ts";

import { drizzle } from "drizzle-orm/netlify-db";

import * as schema from "./schema.ts";

export const priceCheckDb = drizzle({ schema });

export type PriceCheckDb = typeof priceCheckDb;

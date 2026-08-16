import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./spikes/price-check-db/schema.ts",
  out: "./netlify/database/migrations",
});

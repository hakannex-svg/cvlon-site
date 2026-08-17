import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./db/price-check/schema.ts",
  out: "./db/price-check/migrations-netlify-archive",
});

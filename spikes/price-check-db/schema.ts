import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const civilonDbProbe = pgTable("civilon_db_probe", {
  id: serial("id").primaryKey(),
  probeKey: text("probe_key").notNull().unique(),
  probeValue: text("probe_value").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

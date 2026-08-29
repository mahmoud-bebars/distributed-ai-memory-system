import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const projects = sqliteTable("projects", {
  slug: text("slug").primaryKey(),
  title: text("title").notNull(),
  summary: text("summary"),
  tags: text("tags").notNull().default("[]"), // JSON-encoded string array
  r2Key: text("r2_key").notNull(),
  entityCount: integer("entity_count").notNull().default(0),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export type ProjectRow = typeof projects.$inferSelect;
export type NewProjectRow = typeof projects.$inferInsert;

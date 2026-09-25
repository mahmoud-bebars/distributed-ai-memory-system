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

// A project can have any number of share links, each independently
// configured — a label to tell them apart, whether Chat/Docs are exposed
// alongside the always-included Graph/Entries view, and an optional
// expiry. `token` (not `slug`) is the primary key since there's no longer
// one link per project.
export const projectShares = sqliteTable("project_shares", {
  token: text("token").primaryKey(),
  slug: text("slug")
    .notNull()
    .references(() => projects.slug),
  label: text("label"),
  allowChat: integer("allow_chat", { mode: "boolean" }).notNull().default(false),
  allowDocs: integer("allow_docs", { mode: "boolean" }).notNull().default(false),
  // Null means "never expires". Otherwise an ISO timestamp — expiry is
  // computed once at create/update time from a duration (see
  // shares/service.ts's computeExpiresAt), not stored as a duration itself.
  expiresAt: text("expires_at"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export type ProjectShareRow = typeof projectShares.$inferSelect;
export type NewProjectShareRow = typeof projectShares.$inferInsert;

import { z } from "zod";

export const slugSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/, "slug must be lowercase, alphanumeric, and hyphen-separated");

export const createProjectSchema = z.object({
  slug: slugSchema,
  title: z.string().min(1).max(200),
  summary: z.string().max(2000).optional(),
  tags: z.array(z.string()).default([]),
});

export const entityCategorySchema = z.enum([
  "concept",
  "event",
  "feature",
  "organization",
  "person",
  "product",
  "project",
  "research",
  "technology",
  "other",
]);

export type EntityCategory = z.infer<typeof entityCategorySchema>;

export const DEFAULT_ENTITY_CATEGORY: EntityCategory = "other";

export const memoryEntrySchema = z.object({
  id: z.string().min(1), // ulid assigned by the writer (CLI, MCP tool, etc.)
  type: z.enum(["entity", "relation", "observation"]),
  // Left as a generic record — validating it strictly per `type` would
  // reject entries written before these conventions existed, and old
  // entries are meant to keep parsing, not fail. By convention (not
  // enforced here), content shapes are:
  //   entity:      { name: string, category?: EntityCategory }
  //                category defaults to "other" (DEFAULT_ENTITY_CATEGORY)
  //                when a reader doesn't find one.
  //   observation: { text: string, entity?: string }
  //                `entity` names which entity (by name) this note is
  //                about; absent means a general project note.
  //   relation:    { source: string, target: string, label?: string }
  //                unchanged.
  content: z.record(z.unknown()),
  created_at: z.string().datetime().optional(),
});

export const appendMemorySchema = z.object({
  entry: memoryEntrySchema,
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type MemoryEntry = z.infer<typeof memoryEntrySchema>;
export type AppendMemoryInput = z.infer<typeof appendMemorySchema>;

// Row shape now comes from the Drizzle table definition, not hand-rolled here.
export type { ProjectRow } from "../../db/schema";

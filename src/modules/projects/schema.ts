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

export const memoryEntrySchema = z.object({
  id: z.string().min(1), // ulid assigned by the writer (CLI, MCP tool, etc.)
  type: z.enum(["entity", "relation", "observation"]),
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

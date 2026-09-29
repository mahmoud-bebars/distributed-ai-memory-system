import { z } from "zod";
import { deleteDocSchema, docFilenameSchema, updateDocSchema } from "../docs/schema";
import { planInputSchema } from "../actions/schema";
import { entityCategorySchema, memoryEntrySchema, slugSchema } from "../projects/schema";

// MCP tool input schemas.
//
// These are Zod *raw shapes* (plain objects of Zod types), not
// `z.object(...)` wrappers — that's the form `McpServer.registerTool`'s
// `inputSchema` expects, and it's what lets the SDK derive both the JSON
// Schema advertised to clients and the parsed argument types for the tool
// callback. `append_memory` reuses the canonical `memoryEntrySchema` from
// the projects module rather than redefining the memory entry shape here,
// per the "MCP tools are thin wrappers" rule.

export const readMemoryInput = {
  slug: slugSchema,
};

export const appendMemoryInput = {
  slug: slugSchema,
  entry: memoryEntrySchema,
};

export const askMemoryInput = {
  slug: slugSchema,
  question: z.string().min(1).max(4000),
};

export const searchMemoryInput = {
  query: z.string().min(1).max(500),
  // Naming a project explicitly is the one way to search one that hasn't
  // opted in to global search (includeInGlobalSearch) — never a way around a
  // token's project allow-list.
  projectSlugs: z.array(slugSchema).max(20).optional(),
  topK: z.number().int().min(1).max(20).optional(),
};

export const appendDocInput = {
  slug: slugSchema,
  filename: docFilenameSchema,
  content: z.string().min(1).max(100_000),
};

// Reuse docs/schema's canonical shapes via `.shape` rather than redeclaring
// filename/content here — the same updateDocSchema/deleteDocSchema objects
// are also handed straight to zod-to-json-schema for the in-chat Anthropic
// tool definitions (see chat/service.ts), so there's exactly one place that
// defines what these two mutations take as input.
export const updateDocInput = {
  slug: slugSchema,
  ...updateDocSchema.shape,
};

export const deleteDocInput = {
  slug: slugSchema,
  ...deleteDocSchema.shape,
};

export const updateEntityInput = {
  slug: slugSchema,
  name: z.string().min(1),
  category: entityCategorySchema.optional(),
  // Any other entity content fields to merge in beyond `category` — merged
  // onto the existing entry's content, same as `category` would be.
  fields: z.record(z.unknown()).optional(),
};

// propose_actions reuses the canonical plan shape from the actions module.
// Proposing only ever files a pending plan; an admin approves it in the web
// UI, and nothing arriving over MCP executes.
export const proposeActionsInput = planInputSchema.shape;

export const getTaskInput = {
  id: z.string().uuid(),
};

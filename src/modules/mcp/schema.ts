import { z } from "zod";
import { memoryEntrySchema, slugSchema } from "../projects/schema";

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

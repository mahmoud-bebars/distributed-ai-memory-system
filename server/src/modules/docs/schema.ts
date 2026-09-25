import { z } from "zod";

// A filename is a single path segment (no "/"), restricted to safe
// characters, and must end in ".md" — keeps docs plain markdown and rules
// out path traversal without needing a separate refine for "..".
export const docFilenameSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(
    /^[a-zA-Z0-9._-]+\.md$/,
    "filename must contain only letters, numbers, dots, hyphens, and underscores, and end in .md"
  );

const docContentSchema = z.string().min(1).max(100_000);

export const appendDocSchema = z.object({
  filename: docFilenameSchema,
  content: docContentSchema,
});

// Full-overwrite update — see DocsService.update for why this replaces
// rather than appends. Same shape as appendDocSchema by coincidence, not
// aliased to it: the two mean different things (create-or-append vs.
// replace-existing) and are reused separately by the MCP tool and the
// in-chat tool definition.
export const updateDocSchema = z.object({
  filename: docFilenameSchema,
  content: docContentSchema,
});

export const deleteDocSchema = z.object({
  filename: docFilenameSchema,
});

export type AppendDocInput = z.infer<typeof appendDocSchema>;
export type UpdateDocInput = z.infer<typeof updateDocSchema>;
export type DeleteDocInput = z.infer<typeof deleteDocSchema>;

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

export const appendDocSchema = z.object({
  filename: docFilenameSchema,
  content: z.string().min(1).max(100_000),
});

export type AppendDocInput = z.infer<typeof appendDocSchema>;

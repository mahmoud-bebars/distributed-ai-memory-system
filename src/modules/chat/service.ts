import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { Bindings } from "../../lib/bindings";
import { deleteDocSchema, updateDocSchema } from "../docs/schema";
import { DocsService } from "../docs/service";
import type { MemoryEntry } from "../projects/schema";
import { ProjectsService } from "../projects/service";
import type { ChatResponse, ChatSource, ProposedAction } from "./schema";

// Anthropic Messages API. Model IDs and pricing move over time —
// check https://docs.claude.com/en/docs/about-claude/models/overview
// before relying on this in production.
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-5";
const ANTHROPIC_VERSION = "2023-06-01";

// Naive context cap for v1: dumping everything works until a project's
// memory gets large enough to threaten the context window. At that point,
// swap this for a real retrieval step (embed entries, pull top-k by
// similarity to the question) rather than raising this number further.
const MAX_CONTEXT_ENTRIES = 500;

// Converts a shared docs/schema Zod object into the JSON Schema shape the
// Messages API's `tools[].input_schema` expects, so update_doc/delete_doc's
// input shape is defined exactly once (docs/schema.ts) and reused here and
// in mcp/schema.ts — never redeclared by hand.
function toInputSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const json = zodToJsonSchema(schema) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

// These two are the only tools offered to the model in chat — they're
// mutating, so unlike everything else the model already sees dumped into
// the system prompt (memory + docs), calling one is never executed here.
// ChatService.ask returns it as an unexecuted `proposedAction` instead; see
// that method for the approval-gate logic and ChatPanel.tsx for where a
// human actually approves or rejects it.
const UPDATE_DOC_TOOL = {
  name: "update_doc",
  description:
    "Propose replacing a project doc's entire content (full overwrite, not an append). Calling this does NOT write anything — it surfaces a pending change that the user must explicitly approve before it happens. Only call this when the user has actually asked for this specific doc to be changed to this specific content; never call it speculatively or as a guess at what they might want.",
  input_schema: toInputSchema(updateDocSchema),
};

const DELETE_DOC_TOOL = {
  name: "delete_doc",
  description:
    "Propose permanently deleting a project doc file. Calling this does NOT delete anything — it surfaces a pending action that the user must explicitly approve before it happens. Only call this when the user has actually asked for this specific file to be deleted; never call it speculatively.",
  input_schema: toInputSchema(deleteDocSchema),
};

interface AnthropicContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
}

/** Short human-readable label for a memory entry, used to show which
 *  entries a chat answer cited — same idea as the frontend's per-type
 *  summaries (app/src/lib/memory.ts), duplicated here since this runs
 *  server-side before the entry ever reaches the browser. */
function summarizeEntry(entry: MemoryEntry): string {
  if (entry.type === "entity") {
    const name = entry.content.name;
    return typeof name === "string" ? name : entry.id;
  }
  if (entry.type === "relation") {
    const { source, target, label } = entry.content;
    if (typeof source === "string" && typeof target === "string") {
      return typeof label === "string" ? `${source} → ${target} (${label})` : `${source} → ${target}`;
    }
    return entry.id;
  }
  const text = entry.content.text;
  if (typeof text === "string") return text.length > 80 ? `${text.slice(0, 80)}…` : text;
  return entry.id;
}

/** Splits a trailing `SOURCES: id1, id2` line off the model's raw reply.
 *  The model is asked (see the system prompt below) to always end its
 *  answer with this line, listing the entry ids it actually used — this
 *  is a citation the model reports, not a retrieval step we ran. */
function extractSources(raw: string): { answer: string; sourceIds: string[] } {
  const match = raw.match(/\n?SOURCES:\s*(.*)\s*$/i);
  if (!match || match.index === undefined) return { answer: raw, sourceIds: [] };
  const answer = raw.slice(0, match.index).trim();
  const sourceIds = (match[1] ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  return { answer, sourceIds };
}

export class ChatService {
  private readonly projects: ProjectsService;
  private readonly docs: DocsService;

  constructor(private readonly env: Bindings) {
    this.projects = new ProjectsService(env);
    this.docs = new DocsService(env);
  }

  async ask(slug: string, question: string): Promise<ChatResponse> {
    const project = await this.projects.get(slug);
    if (!project) throw new Error(`Unknown project: ${slug}`);

    const entries = await this.projects.readMemory(slug);
    const contextEntries = entries.slice(0, MAX_CONTEXT_ENTRIES);
    const memoryContext = contextEntries.map((entry) => JSON.stringify(entry)).join("\n");

    // Same naive full-dump approach as memory above, reusing DocsService's
    // existing list/read rather than touching R2 directly here. No cap like
    // MAX_CONTEXT_ENTRIES yet — a docs-heavy project can grow this prompt
    // large; see this module's summary note rather than silently truncating.
    const docFilenames = await this.docs.list(slug);
    const docFiles = await Promise.all(
      docFilenames.map(async (filename) => ({
        filename,
        content: (await this.docs.read(slug, filename)) ?? "",
      })),
    );
    const docsContext =
      docFiles.length > 0
        ? docFiles.map(({ filename, content }) => `### ${filename}\n\n${content}`).join("\n\n---\n\n")
        : "(no docs recorded yet)";

    const systemPrompt = [
      `You are a memory assistant for the project "${project.title}".`,
      "Answer only from the memory entries and project docs below. If the",
      "answer isn't in there, say so plainly instead of guessing.",
      "",
      "After your answer, add one final line, exactly:",
      "SOURCES: id1, id2",
      "listing the `id` values of memory entries above that you actually drew",
      'on — omit any you didn\'t use. If none were relevant, write "SOURCES:"',
      "with nothing after it. Never invent an id that isn't listed below.",
      "Docs don't have ids, so never list a filename on the SOURCES line.",
      "",
      "Memory entries (JSONL):",
      memoryContext || "(no entries recorded yet)",
      "",
      "Project docs (separate markdown files, not part of the memory log):",
      docsContext,
      "",
      "You can propose edits to project docs with the update_doc and",
      "delete_doc tools. Calling one does not make the change — it only",
      "shows the user a pending action they must explicitly approve. Only",
      "call one when the user has actually asked for that specific change in",
      "this conversation; never call them speculatively or as a guess.",
    ].join("\n");

    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.env.ANTHROPIC_API_KEY,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        system: systemPrompt,
        tools: [UPDATE_DOC_TOOL, DELETE_DOC_TOOL],
        // At most one tool call per turn — proposedAction only has room for
        // one pending action, so there's nothing useful a second call in the
        // same turn could do.
        tool_choice: { type: "auto", disable_parallel_tool_use: true },
        messages: [{ role: "user", content: question }],
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Anthropic API error (${response.status}): ${detail}`);
    }

    const data = (await response.json()) as { content: AnthropicContentBlock[] };

    const raw = data.content
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("\n")
      .trim();

    const { answer, sourceIds } = extractSources(raw);
    const sources: ChatSource[] = contextEntries
      .filter((entry) => sourceIds.includes(entry.id))
      .map((entry) => ({ id: entry.id, type: entry.type, summary: summarizeEntry(entry) }));

    const proposedAction = this.extractProposedAction(data.content);

    return { answer, sources, ...(proposedAction ? { proposedAction } : {}) };
  }

  /** Picks the first update_doc/delete_doc tool_use block out of a response
   *  and validates its `input` against the same Zod schema used everywhere
   *  else for that tool — the model's input is untrusted the same way any
   *  other external input is, so a malformed call (e.g. a bad filename) is
   *  dropped rather than handed to the frontend as an approvable action. */
  private extractProposedAction(content: AnthropicContentBlock[]): ProposedAction | undefined {
    const block = content.find(
      (b) => b.type === "tool_use" && (b.name === "update_doc" || b.name === "delete_doc"),
    );
    if (!block) return undefined;

    if (block.name === "update_doc") {
      const parsed = updateDocSchema.safeParse(block.input);
      return parsed.success ? { tool: "update_doc", input: parsed.data } : undefined;
    }

    const parsed = deleteDocSchema.safeParse(block.input);
    return parsed.success ? { tool: "delete_doc", input: parsed.data } : undefined;
  }
}

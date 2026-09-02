import type { Bindings } from "../../lib/bindings";
import type { MemoryEntry } from "../projects/schema";
import { ProjectsService } from "../projects/service";
import type { ChatResponse, ChatSource } from "./schema";

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

  constructor(private readonly env: Bindings) {
    this.projects = new ProjectsService(env);
  }

  async ask(slug: string, question: string): Promise<ChatResponse> {
    const project = await this.projects.get(slug);
    if (!project) throw new Error(`Unknown project: ${slug}`);

    const entries = await this.projects.readMemory(slug);
    const contextEntries = entries.slice(0, MAX_CONTEXT_ENTRIES);
    const context = contextEntries.map((entry) => JSON.stringify(entry)).join("\n");

    const systemPrompt = [
      `You are a memory assistant for the project "${project.title}".`,
      "Answer only from the memory entries below. If the answer isn't in",
      "there, say so plainly instead of guessing.",
      "",
      "After your answer, add one final line, exactly:",
      "SOURCES: id1, id2",
      "listing the `id` values of entries above that you actually drew on —",
      "omit any you didn't use. If none were relevant, write \"SOURCES:\"",
      "with nothing after it. Never invent an id that isn't listed below.",
      "",
      "Memory entries (JSONL):",
      context || "(no entries recorded yet)",
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
        messages: [{ role: "user", content: question }],
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Anthropic API error (${response.status}): ${detail}`);
    }

    const data = (await response.json()) as {
      content: Array<{ type: string; text?: string }>;
    };
    const raw = data.content
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("\n")
      .trim();

    const { answer, sourceIds } = extractSources(raw);
    const sources: ChatSource[] = contextEntries
      .filter((entry) => sourceIds.includes(entry.id))
      .map((entry) => ({ id: entry.id, type: entry.type, summary: summarizeEntry(entry) }));

    return { answer, sources };
  }
}

import type { Bindings } from "../../lib/bindings";
import { ProjectsService } from "../projects/service";
import type { ChatResponse } from "./schema";

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

export class ChatService {
  private readonly projects: ProjectsService;

  constructor(private readonly env: Bindings) {
    this.projects = new ProjectsService(env);
  }

  async ask(slug: string, question: string): Promise<ChatResponse> {
    const project = await this.projects.get(slug);
    if (!project) throw new Error(`Unknown project: ${slug}`);

    const entries = await this.projects.readMemory(slug);
    const context = entries
      .slice(0, MAX_CONTEXT_ENTRIES)
      .map((entry) => JSON.stringify(entry))
      .join("\n");

    const systemPrompt = [
      `You are a memory assistant for the project "${project.title}".`,
      "Answer only from the memory entries below. If the answer isn't in",
      "there, say so plainly instead of guessing.",
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
    const answer = data.content
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("\n")
      .trim();

    return { answer };
  }
}

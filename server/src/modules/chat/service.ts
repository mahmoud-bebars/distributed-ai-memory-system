import Anthropic from "@anthropic-ai/sdk";
import type {
  ContentBlockParam,
  MessageParam,
  Tool,
  ToolUseBlock,
} from "@anthropic-ai/sdk/resources/messages";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { Bindings } from "../../lib/bindings";
import { deleteDocSchema, updateDocSchema } from "../docs/schema";
import { DocsService } from "../docs/service";
import type { MemoryEntry } from "../projects/schema";
import { currentEntities, ProjectsService } from "../projects/service";
import type { ProjectRow } from "../../db/schema";
import { Budget } from "../../lib/budget";
import { UNTRUSTED_RULE, wrapUntrusted } from "../../lib/untrusted";
import { SearchService } from "../search";
import {
  listDocsInputSchema,
  readDocInputSchema,
  searchDocsInputSchema,
  searchMemoryInputSchema,
} from "./schema";
import type { ChatHistoryTurn, ChatSource, ChatStreamEvent, ProposedAction } from "./schema";

const MODEL = "claude-sonnet-5";

// A read-only-tool round-trip that finds nothing useful should still let the
// model try a different angle rather than give up immediately, but this
// bounds worst-case cost/latency per question. The last round always runs
// with no tools offered (see the loop below), which structurally forces a
// text answer instead of relying on a prompt nudge to "wrap it up."
const MAX_TOOL_ROUNDS = 4;

const SEARCH_MEMORY_DEFAULT_LIMIT = 8;
const SEARCH_DOCS_DEFAULT_LIMIT = 5;
const DOC_SNIPPET_RADIUS = 160;

// Fine at today's scale (dozens of docs per project) — search_docs reads
// every doc body to score it, which is cheap in R2-GET terms even at this
// cap. If a project's doc count grows enough that this fan-out threatens
// latency, that's the point to add a real doc index, not to raise this
// further.
const MAX_DOC_BODIES_SCANNED = 200;

function toInputSchema(schema: z.ZodTypeAny): Tool["input_schema"] {
  const json = zodToJsonSchema(schema) as Record<string, unknown>;
  delete json.$schema;
  return json as Tool["input_schema"];
}

// Real, EXECUTED read-only tools — unlike UPDATE_DOC_TOOL/DELETE_DOC_TOOL
// below, ChatService runs these itself mid-conversation and feeds the
// result back as a tool_result, instead of dumping the whole project's
// memory/docs into every system prompt regardless of the question.
const SEARCH_MEMORY_TOOL: Tool = {
  name: "search_memory",
  description:
    "Search this project's memory log (entities, relations, observations) for entries relevant to a query. Returns the best-matching entries, not everything — call again with a different query if the first search doesn't turn up what you need.",
  input_schema: toInputSchema(searchMemoryInputSchema),
};

const LIST_DOCS_TOOL: Tool = {
  name: "list_docs",
  description: "List the filenames of this project's docs, with no content — use search_docs or read_doc to look inside one.",
  input_schema: toInputSchema(listDocsInputSchema),
};

const SEARCH_DOCS_TOOL: Tool = {
  name: "search_docs",
  description:
    "Search this project's docs for content relevant to a query. Returns short snippets from the best-matching files, not full content — follow up with read_doc on a specific filename if you need the whole thing.",
  input_schema: toInputSchema(searchDocsInputSchema),
};

const READ_DOC_TOOL: Tool = {
  name: "read_doc",
  description: "Read one project doc's full content by filename.",
  input_schema: toInputSchema(readDocInputSchema),
};

// These two are the only tools that stay unexecuted — calling one does NOT
// write anything, it surfaces a pending change that a human must explicitly
// approve. See ChatPanel.tsx for where that approval actually happens.
const UPDATE_DOC_TOOL: Tool = {
  name: "update_doc",
  description:
    "Propose replacing a project doc's entire content (full overwrite, not an append). Calling this does NOT write anything — it surfaces a pending change that the user must explicitly approve before it happens. Only call this when the user has actually asked for this specific doc to be changed to this specific content; never call it speculatively or as a guess at what they might want.",
  input_schema: toInputSchema(updateDocSchema),
};

const DELETE_DOC_TOOL: Tool = {
  name: "delete_doc",
  description:
    "Propose permanently deleting a project doc file. Calling this does NOT delete anything — it surfaces a pending action that the user must explicitly approve before it happens. Only call this when the user has actually asked for this specific file to be deleted; never call it speculatively.",
  input_schema: toInputSchema(deleteDocSchema),
};

/** Short human-readable label for a memory entry — same idea as the
 *  frontend's per-type summaries (client/src/lib/memory.ts), duplicated
 *  here since this runs server-side. */
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

/** Naive keyword relevance score — no embeddings, this is a tool-driven
 *  search loop rather than a vector store. Counts term occurrences,
 *  case-insensitively; 0 means "no match at all". Good enough at the scale
 *  a single-user project's memory/docs actually reach. */
function scoreText(query: string, text: string): number {
  const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 1);
  if (terms.length === 0) return 0;
  const haystack = text.toLowerCase();
  let score = 0;
  for (const term of terms) {
    score += haystack.split(term).length - 1;
  }
  return score;
}

/** Extracts a short excerpt around the first matched query term, so a doc
 *  search result costs a snippet's worth of tokens instead of the whole
 *  file — the actual efficiency win over the old "dump every doc" prompt. */
function snippetAround(content: string, query: string, radius = DOC_SNIPPET_RADIUS): string {
  const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 1);
  const lower = content.toLowerCase();
  let bestIndex = -1;
  for (const term of terms) {
    const idx = lower.indexOf(term);
    if (idx !== -1 && (bestIndex === -1 || idx < bestIndex)) bestIndex = idx;
  }
  if (bestIndex === -1) {
    return content.length > radius * 2 ? `${content.slice(0, radius * 2)}…` : content;
  }
  const start = Math.max(0, bestIndex - radius);
  const end = Math.min(content.length, bestIndex + radius);
  return `${start > 0 ? "…" : ""}${content.slice(start, end)}${end < content.length ? "…" : ""}`;
}

/** Drives the "what is the agent doing" status line the UI shows while a
 *  tool round is in flight — derived straight from the tool call itself, no
 *  separate bookkeeping to keep in sync. */
function describeToolCall(name: string, input: unknown): string {
  const record = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
  switch (name) {
    case "search_memory":
      return `Searching memory for "${String(record.query ?? "")}"…`;
    case "list_docs":
      return "Listing project docs…";
    case "search_docs":
      return `Searching docs for "${String(record.query ?? "")}"…`;
    case "read_doc":
      return `Reading "${String(record.filename ?? "")}"…`;
    default:
      return "Working…";
  }
}

/** Same guidance in both the doc-scoped and search-driven system prompts —
 *  factored out so the two prompt builders below don't drift. */
function mutatingToolsGuidance(allowMutatingTools: boolean): string[] {
  return allowMutatingTools
    ? [
        "",
        "You can propose edits to project docs with the update_doc and",
        "delete_doc tools. Calling one does not make the change — it only",
        "shows the user a pending action they must explicitly approve. Only",
        "call one when the user has actually asked for that specific change in",
        "this conversation; never call them speculatively or as a guess.",
      ]
    : [
        "",
        "This is a read-only shared view — you have no doc-editing tools here",
        "and cannot propose doc edits.",
      ];
}

interface ToolResult {
  result: string;
  sources: ChatSource[];
}

export class ChatService {
  private readonly projects: ProjectsService;
  private readonly docs: DocsService;
  private readonly client: Anthropic;
  private readonly search: SearchService;
  private readonly budget: Budget;

  constructor(private readonly env: Bindings) {
    this.projects = new ProjectsService(env);
    this.docs = new DocsService(env);
    this.client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    this.search = new SearchService(env);
    this.budget = new Budget(env);
  }

  /** Validates the project (and, if given, the doc) exist BEFORE any
   *  streaming starts — routes.ts calls this first so an unknown
   *  project/doc still 404s cleanly, the same way it did before this
   *  became a streamed response (once streamSSE's headers are sent, we can
   *  no longer change the HTTP status). */
  async assertExists(slug: string, docFilename?: string): Promise<ProjectRow> {
    const project = await this.projects.get(slug);
    if (!project) throw new Error(`Unknown project: ${slug}`);
    if (docFilename && (await this.docs.read(slug, docFilename)) === null) {
      throw new Error(`Unknown doc: ${docFilename} (in project ${slug})`);
    }
    return project;
  }

  /** Streams a chat turn as a sequence of events instead of returning one
   *  JSON blob — status updates while a tool round is in flight, text
   *  deltas as the model's answer is generated, then sources/a proposed
   *  action, then done. Callers (chat/routes.ts, shares/routes.ts) forward
   *  each event onto an SSE stream to the browser via hono/streaming. */
  async *ask(
    slug: string,
    question: string,
    options: {
      docFilename?: string;
      includeDocs?: boolean;
      allowMutatingTools?: boolean;
      history?: ChatHistoryTurn[];
      signal?: AbortSignal;
    } = {},
  ): AsyncGenerator<ChatStreamEvent> {
    const { docFilename, includeDocs = true, allowMutatingTools = true, history = [], signal } = options;
    const project = await this.assertExists(slug, docFilename);

    const mutatingTools: Tool[] = allowMutatingTools ? [UPDATE_DOC_TOOL, DELETE_DOC_TOOL] : [];

    let systemPrompt: string;
    let readOnlyTools: Tool[] = [];
    const executors: Record<string, (input: unknown) => Promise<ToolResult>> = {};

    if (docFilename) {
      // The user already told us exactly which file they want via the UI's
      // doc-scope picker — search would be redundant, so this inlines the
      // one file directly, same as the pre-redesign behavior.
      const content = (await this.docs.read(slug, docFilename))!; // assertExists just confirmed this
      systemPrompt = [
        `You are a memory assistant for the project "${project.title}".`,
        `Answer only from this one doc — "${docFilename}" — which the user has`,
        "explicitly scoped this conversation to. If the answer isn't in it, say",
        "so plainly instead of guessing.",
        UNTRUSTED_RULE,
        "",
        wrapUntrusted([{ id: docFilename, body: content }]),
        ...mutatingToolsGuidance(allowMutatingTools),
      ].join("\n");
    } else {
      const [manifest, docFilenames] = await Promise.all([
        this.buildMemoryManifest(slug),
        includeDocs ? this.docs.list(slug) : Promise.resolve<string[]>([]),
      ]);

      readOnlyTools = [SEARCH_MEMORY_TOOL, ...(includeDocs ? [LIST_DOCS_TOOL, SEARCH_DOCS_TOOL, READ_DOC_TOOL] : [])];
      executors.search_memory = async (input) => {
        const parsed = searchMemoryInputSchema.safeParse(input);
        if (!parsed.success) return { result: "Invalid search_memory input.", sources: [] };
        return this.searchMemory(slug, parsed.data.query, parsed.data.limit);
      };
      if (includeDocs) {
        executors.list_docs = async () => this.listDocsTool(slug);
        executors.search_docs = async (input) => {
          const parsed = searchDocsInputSchema.safeParse(input);
          if (!parsed.success) return { result: "Invalid search_docs input.", sources: [] };
          return this.searchDocs(slug, parsed.data.query, parsed.data.limit);
        };
        executors.read_doc = async (input) => {
          const parsed = readDocInputSchema.safeParse(input);
          if (!parsed.success) return { result: "Invalid read_doc input.", sources: [] };
          return this.readDocTool(slug, parsed.data.filename);
        };
      }

      const docsLine = includeDocs
        ? docFilenames.length > 0
          ? `Project docs (${docFilenames.length} files, filenames only — use list_docs/search_docs/read_doc to look inside): ${docFilenames.join(", ")}`
          : "Project docs: none yet."
        : "Project docs: not included in this conversation.";

      systemPrompt = [
        `You are a memory assistant for the project "${project.title}".`,
        "",
        `This project's memory log has ${manifest}. You have NOT been shown`,
        "their content.",
        docsLine,
        "",
        "Before answering a question about this project's content, use the",
        `search_memory tool${includeDocs ? " (and list_docs/search_docs/read_doc for docs)" : ""} to look up what's`,
        "actually relevant — don't guess, and don't call a tool at all for",
        'small talk or a connectivity check (e.g. "are you there?"); just',
        "answer those directly.",
        "",
        "If a search comes back empty or clearly unrelated to the question,",
        "say plainly that you didn't find anything about that in this",
        "project — optionally offering a couple of specific guesses at what",
        "they might mean — rather than guessing an answer. Never invent facts",
        "that weren't actually returned by a tool.",
        "",
        UNTRUSTED_RULE,
        ...mutatingToolsGuidance(allowMutatingTools),
      ].join("\n");
    }

    const messages: MessageParam[] = [
      ...history.map((turn) => ({ role: turn.role, content: turn.text }) satisfies MessageParam),
      { role: "user", content: question },
    ];

    const collectedSources: ChatSource[] = [];
    let turnTokens = 0;

    for (let round = 0; round < MAX_TOOL_ROUNDS + 1; round++) {
      // Daily + per-turn LLM token caps, checked before every Anthropic call
      // and logged after it (see lib/budget.ts).
      await this.budget.assertLlmRoom(turnTokens);
      const offerTools = round < MAX_TOOL_ROUNDS;
      const tools = offerTools ? [...readOnlyTools, ...mutatingTools] : [];

      const stream = this.client.messages.stream(
        {
          model: MODEL,
          max_tokens: 1024,
          system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
          ...(tools.length > 0
            ? {
                tools: tools.map((tool, i) =>
                  i === tools.length - 1 ? { ...tool, cache_control: { type: "ephemeral" as const } } : tool,
                ),
                tool_choice: { type: "auto" as const, disable_parallel_tool_use: true },
              }
            : {}),
          messages,
        },
        { signal },
      );

      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          yield { type: "text", delta: event.delta.text };
        }
      }

      const finalMessage = await stream.finalMessage();
      const usage = finalMessage.usage;
      const spent =
        usage.input_tokens +
        usage.output_tokens +
        (usage.cache_creation_input_tokens ?? 0) +
        (usage.cache_read_input_tokens ?? 0);
      turnTokens += spent;
      await this.budget.record("llm_tokens", spent);
      messages.push({ role: "assistant", content: finalMessage.content as unknown as ContentBlockParam[] });

      const toolUseBlock = finalMessage.content.find((b): b is ToolUseBlock => b.type === "tool_use");

      if (!toolUseBlock) {
        yield { type: "sources", sources: collectedSources };
        yield { type: "done" };
        return;
      }

      if (toolUseBlock.name === "update_doc" || toolUseBlock.name === "delete_doc") {
        const action = this.parseProposedAction(toolUseBlock);
        if (action) yield { type: "proposedAction", action };
        yield { type: "sources", sources: collectedSources };
        yield { type: "done" };
        return;
      }

      const executor = executors[toolUseBlock.name];
      if (!executor) {
        // Shouldn't happen — we control the tools array — but never crash
        // the turn over an unrecognized tool name.
        yield { type: "sources", sources: collectedSources };
        yield { type: "done" };
        return;
      }

      yield { type: "status", label: describeToolCall(toolUseBlock.name, toolUseBlock.input) };
      const { result, sources } = await executor(toolUseBlock.input);
      collectedSources.push(...sources);

      messages.push({
        role: "user",
        content: [{ type: "tool_result", tool_use_id: toolUseBlock.id, content: result }],
      });
    }
  }

  /** Drains ask()'s event stream into a single result — for callers that
   *  can't consume a stream (the MCP ask_memory tool, which returns one
   *  text block to its caller, not an SSE response). Browser chat should
   *  use ask() directly instead so the UI actually gets to stream. */
  async askOnce(
    slug: string,
    question: string,
    options: {
      docFilename?: string;
      includeDocs?: boolean;
      allowMutatingTools?: boolean;
      history?: ChatHistoryTurn[];
    } = {},
  ): Promise<{ answer: string; sources: ChatSource[]; proposedAction?: ProposedAction }> {
    let answer = "";
    let sources: ChatSource[] = [];
    let proposedAction: ProposedAction | undefined;

    for await (const event of this.ask(slug, question, options)) {
      if (event.type === "text") answer += event.delta;
      else if (event.type === "sources") sources = event.sources;
      else if (event.type === "proposedAction") proposedAction = event.action;
      else if (event.type === "error") throw new Error(event.message);
    }

    return { answer, sources, ...(proposedAction ? { proposedAction } : {}) };
  }

  private parseProposedAction(block: ToolUseBlock): ProposedAction | undefined {
    if (block.name === "update_doc") {
      const parsed = updateDocSchema.safeParse(block.input);
      return parsed.success ? { tool: "update_doc", input: parsed.data } : undefined;
    }
    const parsed = deleteDocSchema.safeParse(block.input);
    return parsed.success ? { tool: "delete_doc", input: parsed.data } : undefined;
  }

  private async buildMemoryManifest(slug: string): Promise<string> {
    const entries = await this.projects.readMemory(slug);
    const counts = { entity: 0, relation: 0, observation: 0 };
    for (const entry of entries) counts[entry.type]++;
    return `${entries.length} entries (${counts.entity} entities, ${counts.relation} relations, ${counts.observation} observations)`;
  }

  private async searchMemory(slug: string, query: string, limit = SEARCH_MEMORY_DEFAULT_LIMIT): Promise<ToolResult> {
    const entries = await this.projects.readMemory(slug);

    // Hybrid index first (Vectorize + FTS5, fused). Hits are mapped back onto
    // the real entries from R2 — the index only ever nominates ids, so what
    // reaches the model (and what gets cited) is always genuine log content.
    let matched: MemoryEntry[] = [];
    try {
      const byId = new Map(entries.map((e) => [e.id, e]));
      const hits = await this.search.searchProject(slug, query, limit);
      matched = hits.flatMap((h) => byId.get(h.entryId) ?? []);
    } catch {
      // Index unavailable (migration not applied, binding down): fall through.
    }

    // Fallback: the original keyword scorer, still used for a project that
    // hasn't been indexed yet or when the index finds nothing.
    if (matched.length === 0) {
      // Entities are last-write-wins, so search the deduped "current" view of
      // them; relations/observations are never deduped, every one is live.
      const pool = [...currentEntities(entries), ...entries.filter((e) => e.type !== "entity")];
      matched = pool
        .map((entry) => ({ entry, score: scoreText(query, `${summarizeEntry(entry)} ${JSON.stringify(entry.content)}`) }))
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(({ entry }) => entry);
    }

    if (matched.length === 0) {
      return { result: "No memory entries matched this query.", sources: [] };
    }

    const sources: ChatSource[] = matched.map((entry) => ({
      kind: "memory",
      id: entry.id,
      type: entry.type,
      summary: summarizeEntry(entry),
    }));

    return {
      result: wrapUntrusted(matched.map((entry) => ({ id: entry.id, body: JSON.stringify(entry) }))),
      sources,
    };
  }

  private async listDocsTool(slug: string): Promise<ToolResult> {
    const filenames = await this.docs.list(slug);
    return { result: filenames.length > 0 ? filenames.join("\n") : "No docs in this project.", sources: [] };
  }

  private async searchDocs(slug: string, query: string, limit = SEARCH_DOCS_DEFAULT_LIMIT): Promise<ToolResult> {
    const filenames = (await this.docs.list(slug)).slice(0, MAX_DOC_BODIES_SCANNED);
    const bodies = await Promise.all(
      filenames.map(async (filename) => ({ filename, content: (await this.docs.read(slug, filename)) ?? "" })),
    );

    const scored = bodies
      .map(({ filename, content }) => ({ filename, content, score: scoreText(query, content) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    if (scored.length === 0) {
      return { result: "No docs matched this query.", sources: [] };
    }

    const sources: ChatSource[] = scored.map(({ filename, content }) => ({
      kind: "doc",
      filename,
      snippet: snippetAround(content, query),
    }));

    const result = wrapUntrusted(
      scored.map(({ filename, content }) => ({
        id: filename,
        body: snippetAround(content, query, DOC_SNIPPET_RADIUS * 2),
      })),
    );

    return { result, sources };
  }

  private async readDocTool(slug: string, filename: string): Promise<ToolResult> {
    const content = await this.docs.read(slug, filename);
    if (content === null) {
      return { result: `No doc named "${filename}" exists in this project.`, sources: [] };
    }
    return {
      result: wrapUntrusted([{ id: filename, body: content }]),
      sources: [{ kind: "doc", filename, snippet: content.length > 200 ? `${content.slice(0, 200)}…` : content }],
    };
  }
}

import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import type { Bindings } from "../../lib/bindings";
import { BudgetExceededError } from "../../lib/budget";
import { callStructured, StructuredOutputError } from "../../lib/llm";
import { UNTRUSTED_RULE, wrapUntrusted } from "../../lib/untrusted";
import { ActionsService, PlanValidationError } from "../actions";
import type { ProjectRow } from "../../db/schema";
import { canAccessProject, type TokenAuth } from "../tokens";
import { ProjectsService } from "../projects/service";
import { SearchService } from "../search";
import { entryText } from "../search/text";
import {
  moveEnvelopeSchema,
  type AssistantEvent,
  type Citation,
  type Move,
  type StoredMessage,
} from "./schema";
import { TasksService } from "./tasks";

// The agent loop is bounded and code-driven: each iteration the model returns
// ONE typed move, code executes reads and validates everything, and the turn
// ends on answer / propose_plan / ask_user. Reads are the only thing the model
// can trigger without a human.
const MAX_ITERATIONS = 5;
const HISTORY_MESSAGES = 10;
const SEARCH_TOP_K = 8;

interface WaitUntil {
  waitUntil(promise: Promise<unknown>): void;
}

interface MessageRow {
  id: string;
  role: "user" | "assistant";
  kind: StoredMessage["kind"];
  content: string;
  citations: string;
  plan_id: string | null;
  created_at: string;
}

const refKey = (slug: string, entryId: string) => `${slug}/${entryId}`;

export class AssistantService {
  private readonly projects: ProjectsService;
  private readonly search: SearchService;
  private readonly tasks: TasksService;
  private readonly actions: ActionsService;

  constructor(
    private readonly env: Bindings,
    ctx?: WaitUntil,
  ) {
    this.projects = new ProjectsService(env);
    this.search = new SearchService(env, ctx);
    this.tasks = new TasksService(env);
    this.actions = new ActionsService(env, ctx);
  }

  // ---- conversations -----------------------------------------------------

  async listConversations(): Promise<{ id: string; title: string; updatedAt: string }[]> {
    const { results } = await this.env.DAMS_DB.prepare(
      "SELECT id, title, updated_at FROM conversations ORDER BY updated_at DESC LIMIT 50",
    ).all<{ id: string; title: string; updated_at: string }>();
    return results.map((r) => ({ id: r.id, title: r.title, updatedAt: r.updated_at }));
  }

  async getMessages(conversationId: string): Promise<StoredMessage[] | null> {
    const exists = await this.env.DAMS_DB.prepare("SELECT id FROM conversations WHERE id = ?").bind(conversationId).first();
    if (!exists) return null;
    const { results } = await this.env.DAMS_DB.prepare(
      "SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at, rowid",
    )
      .bind(conversationId)
      .all<MessageRow>();
    return results.map((r) => ({
      id: r.id,
      role: r.role,
      kind: r.kind,
      content: r.content,
      citations: JSON.parse(r.citations) as Citation[],
      planId: r.plan_id,
      createdAt: r.created_at,
    }));
  }

  private async saveMessage(
    conversationId: string,
    role: "user" | "assistant",
    kind: StoredMessage["kind"],
    content: string,
    extra: { citations?: Citation[]; planId?: string } = {},
  ): Promise<void> {
    await this.env.DAMS_DB.batch([
      this.env.DAMS_DB
        .prepare("INSERT INTO messages (id, conversation_id, role, kind, content, citations, plan_id) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(crypto.randomUUID(), conversationId, role, kind, content, JSON.stringify(extra.citations ?? []), extra.planId ?? null),
      this.env.DAMS_DB.prepare("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?").bind(conversationId),
    ]);
  }

  // ---- privacy scope -----------------------------------------------------

  /** Projects this turn may read: reachable by the token, not archived, and
   *  either opted in to global search or NAMED by the user in this
   *  conversation. Everything the agent searches, reads, cites or proposes
   *  against is confined to this set. */
  private async readableProjects(auth: TokenAuth, userTexts: string[]): Promise<Map<string, ProjectRow>> {
    const said = userTexts.join("\n").toLowerCase();
    const named = (p: ProjectRow) => said.includes(p.slug.toLowerCase()) || (p.title.length >= 3 && said.includes(p.title.toLowerCase()));
    const readable = new Map<string, ProjectRow>();
    for (const p of await this.projects.list()) {
      if (!canAccessProject(auth, p.slug)) continue;
      if (named(p) || (p.includeInGlobalSearch && !p.archived)) readable.set(p.slug, p);
    }
    return readable;
  }

  // ---- the loop ----------------------------------------------------------

  async *chat(
    auth: TokenAuth,
    input: { conversationId?: string; message: string },
  ): AsyncGenerator<AssistantEvent> {
    // 1. conversation + history (read BEFORE saving this turn's message)
    let conversationId = input.conversationId;
    if (conversationId) {
      const exists = await this.env.DAMS_DB.prepare("SELECT id FROM conversations WHERE id = ?").bind(conversationId).first();
      if (!exists) {
        yield { type: "error", message: `Unknown conversation: ${conversationId}` };
        return;
      }
    } else {
      conversationId = crypto.randomUUID();
      await this.env.DAMS_DB.prepare("INSERT INTO conversations (id, title) VALUES (?, ?)")
        .bind(conversationId, input.message.slice(0, 60))
        .run();
    }
    yield { type: "conversation", id: conversationId };

    const history = ((await this.getMessages(conversationId)) ?? []).slice(-HISTORY_MESSAGES);
    const lastAssistant = [...history].reverse().find((m) => m.role === "assistant");
    const userTexts = [...history.filter((m) => m.role === "user").map((m) => m.content), input.message];

    await this.saveMessage(conversationId, "user", "text", input.message);

    // 2. task — the visible, persistent record of this turn
    const taskId = await this.tasks.create(conversationId, input.message.slice(0, 80), input.message);
    yield { type: "task", id: taskId };

    try {
      const readable = await this.readableProjects(auth, userTexts);
      const readableSlugs = new Set(readable.keys());
      const state = await this.tasks.stateSummary();
      const retrieved = new Map<string, Citation>();

      const system = [
        "You are the cross-project knowledge assistant for a personal memory store.",
        "Each step you return exactly ONE move: search, read_entries, answer, propose_plan or ask_user.",
        "- search: find entries across the projects you may read. Do this before answering any question about the user's memory.",
        "- read_entries: fetch specific entries (from search results) in full.",
        "- answer: reply to the user. Cite ONLY entries you actually retrieved this turn, by {slug, entryId}. If nothing relevant turned up, say so — never invent facts.",
        "- propose_plan: propose organising actions (update/archive projects, tag or move entries, write a synthesis, create a project). You never execute anything: the user reviews and approves every plan. Give a rationale that cites retrieved entries.",
        "- ask_user: ask a clarifying question. You MUST use ask_user to confirm the exact slug and title with the user BEFORE proposing create_project; a plan that creates a project is rejected unless your previous message was such a question.",
        "",
        UNTRUSTED_RULE,
        "",
        `Projects you may read this turn: ${readable.size === 0 ? "(none — nothing has opted in to global search, and the user has not named a project)" : Array.from(readable.values()).map((p) => `${p.slug} ("${p.title}")`).join(", ")}.`,
        "A project that hasn't opted in is invisible to you unless the user names it.",
        "",
        "Your active tasks (your state):",
        state,
      ].join("\n");

      // Transcript: prior turns, then this turn's moves and their results.
      const messages: MessageParam[] = [];
      for (const m of history) {
        const text = m.kind === "plan" ? `${m.content} [I proposed a plan; awaiting the user's approval]` : m.content;
        const role = m.role;
        if (messages.length === 0 && role === "assistant") continue; // must start with a user turn
        messages.push({ role, content: text });
      }
      messages.push({ role: "user", content: input.message });

      let taskTokens = 0;

      for (let step = 1; step <= MAX_ITERATIONS; step++) {
        const { value, tokens } = await callStructured(this.env, {
          system,
          messages,
          schema: moveEnvelopeSchema,
          toolName: "next_move",
          toolDescription: "Return your single next move.",
          taskTokens,
        });
        taskTokens += tokens;
        const move: Move = value.move;
        messages.push({ role: "assistant", content: `My move: ${JSON.stringify(move).slice(0, 4000)}` });

        // ---- terminal moves ----
        if (move.type === "answer") {
          const citations = move.citations.flatMap((c) => retrieved.get(refKey(c.slug, c.entryId)) ?? []);
          await this.saveMessage(conversationId, "assistant", "answer", move.text, { citations });
          await this.tasks.setStatus(taskId, "done", "answered", { citations: citations.length, steps: step });
          yield { type: "answer", text: move.text, citations };
          yield { type: "done" };
          return;
        }

        if (move.type === "ask_user") {
          await this.saveMessage(conversationId, "assistant", "ask", move.question);
          await this.tasks.setStatus(taskId, "done", "asked_user", { steps: step });
          yield { type: "ask", question: move.question };
          yield { type: "done" };
          return;
        }

        if (move.type === "propose_plan") {
          const plan = { ...move.plan, citations: move.plan.citations.filter((c) => retrieved.has(refKey(c.slug, c.entryId))) };
          let feedback: string | null = null;

          if (plan.actions.some((a) => a.type === "create_project") && lastAssistant?.kind !== "ask") {
            feedback =
              "Rejected: you may not propose create_project until you have asked the user to confirm the exact slug and title with ask_user and they have replied. Use ask_user now.";
          } else {
            try {
              const stored = await this.actions.propose(auth, plan, "agent", readableSlugs);
              await this.saveMessage(conversationId, "assistant", "plan", stored.summary, { planId: stored.id });
              await this.tasks.setStatus(taskId, "awaiting_approval", "plan_proposed", { steps: step }, stored.id);
              yield { type: "plan", planId: stored.id, summary: stored.summary };
              yield { type: "done" };
              return;
            } catch (err) {
              if (!(err instanceof PlanValidationError)) throw err;
              feedback = `Rejected by validation: ${err.problems.join("; ")}. Fix the plan or choose another move.`;
            }
          }
          messages.push({ role: "user", content: feedback });
          await this.tasks.event(taskId, "plan_rejected", { step, feedback });
          yield { type: "status", label: "Revising the plan…" };
          continue;
        }

        // ---- read moves (executed by code) ----
        if (move.type === "search") {
          yield { type: "status", label: `Searching for "${move.query}"…` };
          await this.tasks.setStep(taskId, `searching: ${move.query}`);
          const wanted = move.projectSlugs?.filter((s) => readableSlugs.has(s)) ?? Array.from(readableSlugs);
          const hits = await this.search.searchSlugs(wanted, move.query, SEARCH_TOP_K);
          for (const h of hits) {
            retrieved.set(refKey(h.project.slug, h.entryId), {
              slug: h.project.slug,
              entryId: h.entryId,
              project: h.project.title,
              snippet: h.snippet,
            });
          }
          messages.push({
            role: "user",
            content:
              hits.length === 0
                ? "Search results: no matching entries in the projects you may read."
                : `Search results (untrusted data):\n${wrapUntrusted(
                    hits.map((h) => ({ id: refKey(h.project.slug, h.entryId), body: `${h.createdAt ?? ""} ${h.snippet}`.trim() })),
                  )}`,
          });
          continue;
        }

        // read_entries
        yield { type: "status", label: `Reading ${move.entries.length} ${move.entries.length === 1 ? "entry" : "entries"}…` };
        await this.tasks.setStep(taskId, "reading entries");
        const blocks: { id: string; body: string }[] = [];
        const missing: string[] = [];
        const logs = new Map<string, Awaited<ReturnType<ProjectsService["readMemory"]>>>();
        for (const ref of move.entries) {
          const project = readable.get(ref.slug);
          if (!project) {
            missing.push(refKey(ref.slug, ref.entryId));
            continue;
          }
          let log = logs.get(ref.slug);
          if (!log) {
            log = await this.projects.readMemory(ref.slug);
            logs.set(ref.slug, log);
          }
          const entry = log.find((e) => e.id === ref.entryId);
          if (!entry) {
            missing.push(refKey(ref.slug, ref.entryId));
            continue;
          }
          const key = refKey(ref.slug, ref.entryId);
          retrieved.set(key, { slug: ref.slug, entryId: ref.entryId, project: project.title, snippet: entryText(entry).slice(0, 240) });
          blocks.push({ id: key, body: JSON.stringify(entry) });
        }
        messages.push({
          role: "user",
          content: `${blocks.length > 0 ? `Entries (untrusted data):\n${wrapUntrusted(blocks)}` : "No entries could be read."}${
            missing.length > 0 ? `\nNot found or not readable: ${missing.join(", ")}` : ""
          }`,
        });
      }

      // Step cap reached without a terminal move.
      const text = "I couldn't finish this within my step budget. Try a narrower question, or name the project you mean.";
      await this.saveMessage(conversationId, "assistant", "answer", text);
      await this.tasks.setStatus(taskId, "failed", "step_cap", { max: MAX_ITERATIONS });
      yield { type: "answer", text, citations: [] };
      yield { type: "done" };
    } catch (err) {
      const message =
        err instanceof BudgetExceededError || err instanceof StructuredOutputError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Unknown error";
      await this.tasks.setStatus(taskId, "failed", err instanceof BudgetExceededError ? "budget" : "error", { message }).catch(() => {});
      yield { type: "error", message };
    }
  }
}

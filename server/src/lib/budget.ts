import type { Bindings } from "./bindings";

// Free-plan guard rails. Two independent daily counters live in D1's
// `usage_daily` table (migration 0006): Anthropic tokens spent by chat, and
// estimated Workers AI embedding tokens. Every LLM call checks before it
// runs and records after — going over a cap degrades (chat refuses, indexing
// pauses and leaves entries pending) instead of breaking writes.

export type UsageKind = "llm_tokens" | "ai_tokens";

const DEFAULT_LLM_DAILY_TOKEN_CAP = 500_000;
const DEFAULT_LLM_TASK_TOKEN_CAP = 100_000;
// bge-m3 costs roughly 1k neurons per million input tokens, so 10k
// neurons/day is ~9M tokens; stay well under it.
const DEFAULT_AI_DAILY_TOKEN_CAP = 5_000_000;

export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetExceededError";
  }
}

const today = () => new Date().toISOString().slice(0, 10);

function parseCap(raw: string | undefined, fallback: number): number {
  const n = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export class Budget {
  constructor(private readonly env: Bindings) {}

  get llmTaskCap(): number {
    return parseCap(this.env.LLM_TASK_TOKEN_CAP, DEFAULT_LLM_TASK_TOKEN_CAP);
  }

  private capFor(kind: UsageKind): number {
    return kind === "llm_tokens"
      ? parseCap(this.env.LLM_DAILY_TOKEN_CAP, DEFAULT_LLM_DAILY_TOKEN_CAP)
      : parseCap(this.env.WORKERS_AI_DAILY_TOKEN_CAP, DEFAULT_AI_DAILY_TOKEN_CAP);
  }

  async used(kind: UsageKind): Promise<number> {
    const row = await this.env.DAMS_DB.prepare("SELECT units FROM usage_daily WHERE day = ? AND kind = ?")
      .bind(today(), kind)
      .first<{ units: number }>();
    return row?.units ?? 0;
  }

  /** True while today's usage is still under the cap. Never throws. */
  async hasRoom(kind: UsageKind): Promise<boolean> {
    try {
      return (await this.used(kind)) < this.capFor(kind);
    } catch {
      // Can't read the counter (e.g. migration not applied yet): fail open
      // for embeddings (they're best-effort), the caller decides for chat.
      return true;
    }
  }

  /** Throws BudgetExceededError if the daily cap or the per-task cap is
   *  already spent. `taskTokens` is what this turn/task has used so far. */
  async assertLlmRoom(taskTokens = 0): Promise<void> {
    if (taskTokens >= this.llmTaskCap) {
      throw new BudgetExceededError(`This request hit its per-task token cap (${this.llmTaskCap}).`);
    }
    let spent = 0;
    try {
      spent = await this.used("llm_tokens");
    } catch {
      // Counter table missing (migration 0006 not applied yet): don't take
      // chat down over a bookkeeping table — the per-task cap above still applies.
    }
    if (spent >= this.capFor("llm_tokens")) {
      throw new BudgetExceededError("The daily LLM token budget is spent — try again tomorrow (UTC).");
    }
  }

  async record(kind: UsageKind, units: number): Promise<void> {
    if (units <= 0) return;
    try {
      await this.env.DAMS_DB.prepare(
        "INSERT INTO usage_daily (day, kind, units) VALUES (?, ?, ?) ON CONFLICT (day, kind) DO UPDATE SET units = units + excluded.units",
      )
        .bind(today(), kind, Math.round(units))
        .run();
    } catch {
      // Usage logging must never break the call it's logging.
    }
  }
}

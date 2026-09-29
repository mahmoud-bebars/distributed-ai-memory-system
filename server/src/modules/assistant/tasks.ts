import type { Bindings } from "../../lib/bindings";
import { ActionsService, PlanStateError } from "../actions";
import type { TokenAuth } from "../tokens";
import type { StoredTask, TaskStatus } from "./schema";

interface TaskRow {
  id: string;
  conversation_id: string;
  title: string;
  goal: string;
  status: TaskStatus;
  plan_id: string | null;
  current_step: string | null;
  created_at: string;
  updated_at: string;
}

const toTask = (r: TaskRow): StoredTask => ({
  id: r.id,
  conversationId: r.conversation_id,
  title: r.title,
  goal: r.goal,
  status: r.status,
  planId: r.plan_id,
  currentStep: r.current_step,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const ACTIVE: TaskStatus[] = ["planning", "awaiting_approval", "running"];
// A turn that never finished (the Worker died mid-loop) shouldn't sit as an
// "active" task forever.
const STALE_PLANNING_MINUTES = 10;

/** Tasks are D1 rows, not Workflow state: visible, resumable, cancellable.
 *  A task's status after the agent hands off a plan simply mirrors that
 *  plan's status (refreshFromPlans) — the plan is the unit of work, the task
 *  is the user-facing view of it. */
export class TasksService {
  constructor(private readonly env: Bindings) {}

  async create(conversationId: string, title: string, goal: string): Promise<string> {
    const id = crypto.randomUUID();
    await this.env.DAMS_DB.prepare("INSERT INTO tasks (id, conversation_id, title, goal) VALUES (?, ?, ?, ?)")
      .bind(id, conversationId, title, goal)
      .run();
    await this.event(id, "created");
    return id;
  }

  async event(taskId: string, event: string, detail?: unknown): Promise<void> {
    await this.env.DAMS_DB.prepare("INSERT INTO task_events (task_id, event, detail) VALUES (?, ?, ?)")
      .bind(taskId, event, detail === undefined ? null : JSON.stringify(detail))
      .run();
  }

  async setStep(taskId: string, step: string): Promise<void> {
    await this.env.DAMS_DB.prepare("UPDATE tasks SET current_step = ?, updated_at = datetime('now') WHERE id = ?")
      .bind(step, taskId)
      .run();
  }

  async setStatus(taskId: string, status: TaskStatus, event: string, detail?: unknown, planId?: string): Promise<void> {
    await this.env.DAMS_DB.prepare(
      "UPDATE tasks SET status = ?, plan_id = COALESCE(?, plan_id), updated_at = datetime('now') WHERE id = ?",
    )
      .bind(status, planId ?? null, taskId)
      .run();
    await this.event(taskId, event, detail);
  }

  /** Pulls each handed-off task's status from its plan, expires stale ones,
   *  and fails abandoned planning turns. Cheap; called on every list and by
   *  the cron. */
  async refreshFromPlans(): Promise<void> {
    const { results } = await this.env.DAMS_DB.prepare(
      "SELECT t.id AS id, t.status AS status, p.status AS plan_status, p.error AS plan_error FROM tasks t JOIN action_plans p ON p.id = t.plan_id WHERE t.status IN ('awaiting_approval', 'running')",
    ).all<{ id: string; status: TaskStatus; plan_status: string; plan_error: string | null }>();

    for (const r of results) {
      const next: TaskStatus | null =
        r.plan_status === "pending" ? "awaiting_approval"
        : r.plan_status === "running" ? "running"
        : r.plan_status === "done" ? "done"
        : r.plan_status === "failed" ? "failed"
        : r.plan_status === "rejected" ? (r.plan_error === "expired" ? "expired" : "cancelled")
        : null;
      if (next && next !== r.status) await this.setStatus(r.id, next, `plan_${r.plan_status}`, r.plan_error ?? undefined);
    }

    const { results: stale } = await this.env.DAMS_DB.prepare(
      `SELECT id FROM tasks WHERE status = 'planning' AND updated_at < datetime('now', '-${STALE_PLANNING_MINUTES} minutes')`,
    ).all<{ id: string }>();
    for (const { id } of stale) await this.setStatus(id, "failed", "interrupted");
  }

  async list(): Promise<{ active: StoredTask[]; recent: StoredTask[] }> {
    await this.refreshFromPlans();
    const { results } = await this.env.DAMS_DB.prepare("SELECT * FROM tasks ORDER BY updated_at DESC LIMIT 60").all<TaskRow>();
    const all = results.map(toTask);
    return {
      active: all.filter((t) => ACTIVE.includes(t.status)),
      recent: all.filter((t) => !ACTIVE.includes(t.status)).slice(0, 15),
    };
  }

  async get(id: string): Promise<StoredTask | null> {
    await this.refreshFromPlans();
    const row = await this.env.DAMS_DB.prepare("SELECT * FROM tasks WHERE id = ?").bind(id).first<TaskRow>();
    if (!row) return null;
    const { results } = await this.env.DAMS_DB.prepare(
      "SELECT at, event, detail FROM task_events WHERE task_id = ? ORDER BY id",
    )
      .bind(id)
      .all<{ at: string; event: string; detail: string | null }>();
    return { ...toTask(row), events: results };
  }

  /** The "state" the agent is shown each turn: what it's in the middle of. */
  async stateSummary(): Promise<string> {
    const { active } = await this.list();
    if (active.length === 0) return "No active tasks.";
    return active
      .slice(0, 5)
      .map((t) => `- [${t.status}] ${t.title}${t.planId ? ` (plan ${t.planId})` : ""}`)
      .join("\n");
  }

  /** Cancel: only something that hasn't started changing data. A pending plan
   *  is rejected; a plan that's already running can't be yanked mid-way. */
  async cancel(auth: TokenAuth, id: string): Promise<StoredTask> {
    const task = await this.get(id);
    if (!task) throw new PlanStateError(`Unknown task: ${id}`);
    if (task.status === "running") throw new PlanStateError("A running task can't be cancelled — its plan is already executing");
    if (!ACTIVE.includes(task.status)) throw new PlanStateError(`Task is already ${task.status}`);
    if (task.planId) await new ActionsService(this.env).reject(auth, task.planId).catch(() => {});
    await this.setStatus(id, "cancelled", "cancelled", { by: auth.name });
    return (await this.get(id))!;
  }

  /** Retry a failed task's plan, or resume one stuck running after a restart. */
  async resume(auth: TokenAuth, id: string, ctx?: { waitUntil(p: Promise<unknown>): void }): Promise<StoredTask> {
    const task = await this.get(id);
    if (!task) throw new PlanStateError(`Unknown task: ${id}`);
    if (!task.planId) throw new PlanStateError("This task has no plan to resume");
    await new ActionsService(this.env, ctx).resume(auth, task.planId);
    await this.setStatus(id, "running", "resumed", { by: auth.name });
    return (await this.get(id))!;
  }
}

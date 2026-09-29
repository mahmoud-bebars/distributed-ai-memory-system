import type { Bindings } from "../../lib/bindings";
import type { TokenAuth } from "../tokens";
import { ProjectsService } from "../projects/service";
import { executeAction } from "./execute";
import {
  actionSchema,
  type Action,
  type ActionStatus,
  type PlanInput,
  type PlanSource,
  type PlanStatus,
  type StoredAction,
  type StoredPlan,
} from "./schema";
import { validatePlan } from "./validate";

export class PlanValidationError extends Error {
  constructor(readonly problems: string[]) {
    super(`Plan is invalid: ${problems.join("; ")}`);
    this.name = "PlanValidationError";
  }
}
export class PlanNotFoundError extends Error {
  constructor(id: string) {
    super(`Unknown plan: ${id}`);
    this.name = "PlanNotFoundError";
  }
}
export class PlanStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanStateError";
  }
}
export class PlanConfirmationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanConfirmationError";
  }
}

interface PlanRow {
  id: string;
  status: PlanStatus;
  summary: string;
  rationale: string;
  citations: string;
  source: PlanSource;
  proposed_by: string;
  approved_by: string | null;
  error: string | null;
  created_at: string;
  approved_at: string | null;
  finished_at: string | null;
}
interface ActionRow {
  id: string;
  seq: number;
  type: StoredAction["type"];
  payload: string;
  status: ActionStatus;
  result: string | null;
  inverse: string | null;
  error: string | null;
}

const parseJson = (raw: string | null): unknown => (raw === null ? null : JSON.parse(raw));

interface WaitUntil {
  waitUntil(promise: Promise<unknown>): void;
}

export class ActionsService {
  private readonly projects: ProjectsService;

  constructor(
    private readonly env: Bindings,
    private readonly ctx?: WaitUntil,
  ) {
    this.projects = new ProjectsService(env);
  }

  private async audit(actor: string, event: string, planId: string | null, actionId: string | null, detail?: unknown) {
    try {
      await this.env.DAMS_DB.prepare(
        "INSERT INTO audit_log (actor, event, plan_id, action_id, detail) VALUES (?, ?, ?, ?, ?)",
      )
        .bind(actor, event, planId, actionId, detail === undefined ? null : JSON.stringify(detail))
        .run();
    } catch {
      // An audit-write failure must not abort a state change that already happened.
    }
  }

  /** Validates and stores a plan as `pending`. Nothing executes here — over
   *  REST, MCP, or the assistant, a proposal only ever creates a pending row
   *  that waits for an admin's approval. */
  async propose(
    auth: TokenAuth,
    input: PlanInput,
    source: PlanSource,
    readableSlugs?: ReadonlySet<string>,
  ): Promise<StoredPlan> {
    const problems = await validatePlan(this.projects, auth, input, readableSlugs);
    if (problems.length > 0) throw new PlanValidationError(problems);

    const planId = crypto.randomUUID();
    const db = this.env.DAMS_DB;
    await db.batch([
      db
        .prepare(
          "INSERT INTO action_plans (id, status, summary, rationale, citations, source, proposed_by) VALUES (?, 'pending', ?, ?, ?, ?, ?)",
        )
        .bind(planId, input.summary, input.rationale, JSON.stringify(input.citations), source, auth.name),
      ...input.actions.map((action, seq) =>
        db
          .prepare("INSERT INTO plan_actions (id, plan_id, seq, type, payload) VALUES (?, ?, ?, ?, ?)")
          .bind(crypto.randomUUID(), planId, seq, action.type, JSON.stringify(action)),
      ),
    ]);
    await this.audit(auth.name, "proposed", planId, null, { source, actions: input.actions.map((a) => a.type) });
    return (await this.get(planId))!;
  }

  async list(status?: PlanStatus): Promise<StoredPlan[]> {
    const { results } = await (status
      ? this.env.DAMS_DB.prepare("SELECT * FROM action_plans WHERE status = ? ORDER BY created_at DESC LIMIT 100").bind(status)
      : this.env.DAMS_DB.prepare("SELECT * FROM action_plans ORDER BY created_at DESC LIMIT 100")
    ).all<PlanRow>();
    return Promise.all(results.map((row) => this.hydrate(row)));
  }

  async get(id: string): Promise<StoredPlan | null> {
    const row = await this.env.DAMS_DB.prepare("SELECT * FROM action_plans WHERE id = ?").bind(id).first<PlanRow>();
    return row ? this.hydrate(row) : null;
  }

  private async hydrate(row: PlanRow): Promise<StoredPlan> {
    const { results } = await this.env.DAMS_DB.prepare("SELECT * FROM plan_actions WHERE plan_id = ? ORDER BY seq")
      .bind(row.id)
      .all<ActionRow>();
    return {
      id: row.id,
      status: row.status,
      summary: row.summary,
      rationale: row.rationale,
      citations: JSON.parse(row.citations) as StoredPlan["citations"],
      source: row.source,
      proposedBy: row.proposed_by,
      approvedBy: row.approved_by,
      error: row.error,
      createdAt: row.created_at,
      approvedAt: row.approved_at,
      finishedAt: row.finished_at,
      actions: results.map((a) => ({
        id: a.id,
        seq: a.seq,
        type: a.type,
        payload: actionSchema.parse(JSON.parse(a.payload)),
        status: a.status,
        result: parseJson(a.result),
        inverse: parseJson(a.inverse),
        error: a.error,
      })),
    };
  }

  async reject(auth: TokenAuth, id: string): Promise<StoredPlan> {
    const changed = await this.env.DAMS_DB.prepare(
      "UPDATE action_plans SET status = 'rejected', finished_at = datetime('now') WHERE id = ? AND status = 'pending'",
    )
      .bind(id)
      .run();
    if (changed.meta.changes === 0) await this.explainNoTransition(id, "rejected");
    await this.audit(auth.name, "rejected", id, null);
    return (await this.get(id))!;
  }

  /** THE approval gate. Moves pending → running atomically (a second approval
   *  of the same plan changes nothing and is refused, so an action can never
   *  run twice), after checking that every create_project action has been
   *  individually confirmed by typing its slug. Only then is execution
   *  dispatched — to the Workflow when bound, otherwise inline. */
  async approve(auth: TokenAuth, id: string, confirmations: Record<string, string>): Promise<StoredPlan> {
    const plan = await this.get(id);
    if (!plan) throw new PlanNotFoundError(id);
    if (plan.status !== "pending") throw new PlanStateError(`Plan is ${plan.status}, not pending`);

    const unconfirmed = plan.actions.filter(
      (a) => a.payload.type === "create_project" && confirmations[a.id]?.trim() !== a.payload.slug,
    );
    if (unconfirmed.length > 0) {
      throw new PlanConfirmationError(
        `Creating a project needs its own confirmation — type the slug to confirm: ${unconfirmed
          .map((a) => (a.payload.type === "create_project" ? a.payload.slug : a.id))
          .join(", ")}`,
      );
    }

    const changed = await this.env.DAMS_DB.prepare(
      "UPDATE action_plans SET status = 'running', approved_by = ?, approved_at = datetime('now') WHERE id = ? AND status = 'pending'",
    )
      .bind(auth.name, id)
      .run();
    if (changed.meta.changes === 0) await this.explainNoTransition(id, "running");
    await this.audit(auth.name, "approved", id, null, { confirmedCreates: unconfirmed.length === 0 });

    await this.dispatch(id, id);
    return (await this.get(id))!;
  }

  // Hands a `running` plan to the Workflow (or runs it in-process). The
  // instance id must be unique per Workflow instance, hence the parameter —
  // a resume can't reuse the id the first attempt used.
  private async dispatch(planId: string, instanceId: string): Promise<void> {
    if (this.env.ACTIONS_WORKFLOW) {
      await this.env.ACTIONS_WORKFLOW.create({ id: instanceId, params: { planId } });
    } else {
      const run = this.executePlan(planId).catch(() => {});
      if (this.ctx) this.ctx.waitUntil(run);
      else await run;
    }
  }

  /** Retry a failed plan, or resume one stuck `running` after a restart
   *  (a Worker/Workflow died mid-run). Only not-yet-done actions run again;
   *  finished ones are skipped, and each executor is idempotent anyway. */
  async resume(auth: TokenAuth, id: string): Promise<StoredPlan> {
    const plan = await this.get(id);
    if (!plan) throw new PlanNotFoundError(id);
    if (plan.status !== "failed" && plan.status !== "running") {
      throw new PlanStateError(`Plan is ${plan.status}; only a failed or running plan can be resumed`);
    }
    await this.env.DAMS_DB.batch([
      this.env.DAMS_DB
        .prepare("UPDATE action_plans SET status = 'running', error = NULL, finished_at = NULL WHERE id = ?")
        .bind(id),
      this.env.DAMS_DB
        .prepare("UPDATE plan_actions SET status = 'pending', error = NULL WHERE plan_id = ? AND status = 'failed'")
        .bind(id),
    ]);
    await this.audit(auth.name, "resumed", id, null);
    await this.dispatch(id, `${id}-r${Date.now()}`);
    return (await this.get(id))!;
  }

  /** Approval timeout: a plan nobody approved for `days` days is rejected as
   *  expired, so stale proposals don't pile up (and can be re-proposed). */
  async expirePending(days = 7): Promise<string[]> {
    const { results } = await this.env.DAMS_DB
      .prepare("SELECT id FROM action_plans WHERE status = 'pending' AND created_at < datetime('now', ?)")
      .bind(`-${days} days`)
      .all<{ id: string }>();
    for (const { id } of results) {
      await this.env.DAMS_DB
        .prepare("UPDATE action_plans SET status = 'rejected', error = 'expired', finished_at = datetime('now') WHERE id = ? AND status = 'pending'")
        .bind(id)
        .run();
      await this.audit("system", "expired", id, null);
    }
    return results.map((r) => r.id);
  }

  private async explainNoTransition(id: string, to: string): Promise<never> {
    const current = await this.get(id);
    if (!current) throw new PlanNotFoundError(id);
    throw new PlanStateError(`Plan is ${current.status}; cannot move it to ${to}`);
  }

  /** Runs one action of a running plan, recording result, inverse and audit.
   *  Idempotent: an action already `done` returns its stored result, and each
   *  executor de-duplicates its own appends by deterministic entry ids — so a
   *  Workflow step retry can never double-apply. */
  async runAction(planId: string, actionId: string): Promise<Record<string, unknown>> {
    const row = await this.env.DAMS_DB.prepare("SELECT * FROM plan_actions WHERE id = ? AND plan_id = ?")
      .bind(actionId, planId)
      .first<ActionRow>();
    if (!row) throw new Error(`Unknown action: ${actionId}`);
    if (row.status === "done") return (parseJson(row.result) as Record<string, unknown> | null) ?? {};

    const planStatus = await this.env.DAMS_DB.prepare("SELECT status FROM action_plans WHERE id = ?")
      .bind(planId)
      .first<{ status: PlanStatus }>();
    if (planStatus?.status !== "running") throw new PlanStateError("Plan is not running");

    const action: Action = actionSchema.parse(JSON.parse(row.payload));
    try {
      const outcome = await executeAction(this.env, actionId, action);
      await this.env.DAMS_DB.prepare(
        "UPDATE plan_actions SET status = 'done', result = ?, inverse = ?, error = NULL, updated_at = datetime('now') WHERE id = ?",
      )
        .bind(JSON.stringify(outcome.result), outcome.inverse ? JSON.stringify(outcome.inverse) : null, actionId)
        .run();
      await this.audit("system", "action_done", planId, actionId, { type: action.type, result: outcome.result, inverse: outcome.inverse });
      return outcome.result;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      await this.env.DAMS_DB.prepare("UPDATE plan_actions SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ?")
        .bind(message, actionId)
        .run();
      await this.audit("system", "action_failed", planId, actionId, { type: action.type, error: message });
      throw err;
    }
  }

  async finishPlan(planId: string): Promise<void> {
    await this.env.DAMS_DB.prepare(
      "UPDATE action_plans SET status = 'done', finished_at = datetime('now') WHERE id = ? AND status = 'running'",
    )
      .bind(planId)
      .run();
    await this.audit("system", "plan_done", planId, null);
  }

  /** A failed action stops the plan; actions that already ran stay done and
   *  are reported (each action row keeps its own status). */
  async failPlan(planId: string, message: string): Promise<void> {
    await this.env.DAMS_DB.prepare(
      "UPDATE action_plans SET status = 'failed', error = ?, finished_at = datetime('now') WHERE id = ? AND status = 'running'",
    )
      .bind(message, planId)
      .run();
    await this.audit("system", "plan_failed", planId, null, { error: message });
  }

  async actionIds(planId: string): Promise<string[]> {
    const { results } = await this.env.DAMS_DB.prepare("SELECT id FROM plan_actions WHERE plan_id = ? ORDER BY seq")
      .bind(planId)
      .all<{ id: string }>();
    return results.map((r) => r.id);
  }

  /** Sequential in-process execution — the fallback when no Workflows binding
   *  is configured (the Workflow does the same, one step per action). */
  async executePlan(planId: string): Promise<void> {
    try {
      for (const id of await this.actionIds(planId)) await this.runAction(planId, id);
      await this.finishPlan(planId);
    } catch (err) {
      await this.failPlan(planId, err instanceof Error ? err.message : "Unknown error");
    }
  }
}

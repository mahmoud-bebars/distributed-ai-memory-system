import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import type { ActionsWorkflowParams, Bindings } from "../../lib/bindings";
import { ActionsService } from "./service";

/** Executes an APPROVED plan: one `step.do` per action with fixed names and
 *  explicit retries. Approval already happened (ActionsService.approve
 *  flipped the plan to `running` before creating this instance) — the
 *  Workflow never decides anything, it just carries the work out. State
 *  lives in D1, not here (Free-plan Workflow state is kept only 3 days). */
export class ActionsWorkflow extends WorkflowEntrypoint<Bindings, ActionsWorkflowParams> {
  async run(event: Readonly<WorkflowEvent<ActionsWorkflowParams>>, step: WorkflowStep): Promise<void> {
    const actions = new ActionsService(this.env);
    const { planId } = event.payload;

    const ids = await step.do("load-actions", () => actions.actionIds(planId));

    try {
      for (const id of ids) {
        await step.do(
          `action-${id}`,
          { retries: { limit: 2, delay: "3 seconds", backoff: "exponential" }, timeout: "30 seconds" },
          async () => {
            await actions.runAction(planId, id);
            return { ok: true };
          },
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      await step.do("mark-failed", () => actions.failPlan(planId, message).then(() => ({ failed: true })));
      return;
    }

    await step.do("mark-done", () => actions.finishPlan(planId).then(() => ({ done: true })));
  }
}

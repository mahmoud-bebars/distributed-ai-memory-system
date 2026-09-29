import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import type { Bindings, SearchBackfillParams } from "../../lib/bindings";
import { BACKFILL_BATCH, SearchService } from "./service";

// Free plan: 1,024 steps per Workflow instance. Stop well short of it and
// hand the remaining work to a fresh chained instance.
const MAX_STEPS_PER_INSTANCE = 900;

/** Walks every project's memory.jsonl in small batches, one step per batch,
 *  and (re)indexes it. Idempotent and safe to re-run — see
 *  SearchService.reindexBatch. Step names are deterministic (project slug +
 *  offset) so a Workflow restart replays cached steps instead of redoing
 *  them. */
export class SearchBackfillWorkflow extends WorkflowEntrypoint<Bindings, SearchBackfillParams> {
  async run(event: Readonly<WorkflowEvent<SearchBackfillParams>>, step: WorkflowStep): Promise<void> {
    const search = new SearchService(this.env);
    const cursor = event.payload.cursor;

    const slugs = await step.do("list-projects", () => search.listProjectSlugs());
    let steps = 1;

    for (const slug of slugs) {
      if (cursor && slug < cursor.slug) continue;
      let offset = cursor && slug === cursor.slug ? cursor.offset : 0;

      for (;;) {
        if (steps >= MAX_STEPS_PER_INSTANCE) {
          await step.do(`chain-${slug}-${offset}`, async () => {
            await this.env.SEARCH_WORKFLOW?.create({ params: { cursor: { slug, offset } } });
            return { chained: true };
          });
          return;
        }

        const result = await step.do(
          `index-${slug}-${offset}`,
          { retries: { limit: 3, delay: "5 seconds", backoff: "exponential" }, timeout: "30 seconds" },
          () => search.reindexBatch(slug, offset, BACKFILL_BATCH),
        );
        steps++;
        if (result.next === null) break;
        offset = result.next;
      }
    }
  }
}

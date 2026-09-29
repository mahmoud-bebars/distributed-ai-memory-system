export interface Bindings {
  DAMS_DB: D1Database;
  DAMS_BUCKET: R2Bucket;
  ASSETS: Fetcher;
  ANTHROPIC_API_KEY: string;

  // Optional search bindings — declared in wrangler.toml.example, wired to
  // real resources from the Cloudflare dashboard / `wrangler vectorize
  // create`. Every feature that uses them degrades when they're absent
  // (keyword-only search, inline instead of Workflow execution) rather than
  // failing, and none of them can ever fail a memory write.
  AI?: Ai;
  VECTORIZE?: Vectorize;
  SEARCH_WORKFLOW?: Workflow<SearchBackfillParams>;
  ACTIONS_WORKFLOW?: Workflow<ActionsWorkflowParams>;

  // Optional free-tier budget guards (numbers as strings, since [vars] are
  // strings). Unset means the defaults in lib/budget.ts.
  LLM_DAILY_TOKEN_CAP?: string; // Anthropic tokens per UTC day
  LLM_TASK_TOKEN_CAP?: string; // Anthropic tokens per single chat turn / task
  WORKERS_AI_DAILY_TOKEN_CAP?: string; // estimated embedding tokens per UTC day

  // "development" locally (wrangler dev), unset/"production" when deployed —
  // gates the session cookie's Secure attribute (see modules/tokens/routes.ts),
  // since browsers reject Secure cookies over plain http.
  ENVIRONMENT?: string;

  // Break-glass / bootstrap credential for the token-based auth layer (see
  // modules/tokens). Always resolves to admin scope, constant-time-compared,
  // never a database row — set once with `wrangler secret put
  // DAMS_ADMIN_TOKEN`, log in with it, then create real tokens and (per
  // taste) stop using it day-to-day.
  DAMS_ADMIN_TOKEN: string;

  // Optional. The one hostname (if any) you've deliberately left outside
  // whatever access control sits in front of your main domain, so that
  // unauthenticated recipients of a share link — and MCP clients hitting
  // /mcp — can still be reached. See CLAUDE.md's "Shareable read-only
  // links" section. Leave unset if you don't have a separate access-gated
  // domain; share links then just resolve on whatever host served the
  // request, and the host-guard middleware in index.ts is skipped entirely.
  SHARE_HOSTNAME?: string;
}

// Params of the backfill Workflow (modules/search/workflow.ts). Lives here
// so Bindings can name it without importing a module (modules import
// Bindings, not the other way round).
export interface SearchBackfillParams {
  // Where to resume after a chained instance hand-off: the project slug and
  // entry offset to continue from. Absent = start from the beginning.
  cursor?: { slug: string; offset: number };
  // Only these projects (still subject to being opted in). Absent = every
  // opted-in project. Carried across chained instances.
  slugs?: string[];
}

// Params of the plan-execution Workflow (modules/actions/workflow.ts).
export interface ActionsWorkflowParams {
  planId: string;
}

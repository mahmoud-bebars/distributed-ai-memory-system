import { useCallback, useEffect, useState } from "react";
import { api, type PlanAction, type StoredPlan, type StoredPlanAction } from "@/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertTriangle, Check, RefreshCw, X } from "lucide-react";

// Human-readable preview of exactly what an action will do — what is created
// or changed, and in which project. Nothing here runs anything; approval
// happens in PlanCard.
function describe(action: PlanAction): { title: string; detail?: string } {
  switch (action.type) {
    case "create_project":
      return {
        title: `Create project "${action.title}" (${action.slug})`,
        detail: `${action.includeInGlobalSearch ? "Included" : "Not included"} in global search${action.summary ? ` · ${action.summary}` : ""}`,
      };
    case "update_project": {
      const changes = [
        action.title !== undefined && `title → "${action.title}"`,
        action.summary !== undefined && "summary changed",
        action.tags !== undefined && `tags → ${action.tags.join(", ") || "(none)"}`,
        action.includeInGlobalSearch !== undefined && `global search → ${action.includeInGlobalSearch ? "on" : "off"}`,
        action.archived !== undefined && (action.archived ? "archive" : "unarchive"),
      ].filter(Boolean);
      return { title: `Update project ${action.slug}`, detail: changes.join(" · ") };
    }
    case "archive_project":
      return { title: `Archive project ${action.slug}`, detail: "Soft flag only — nothing is deleted; reversible." };
    case "tag_entries":
      return {
        title: `Tag ${action.entryIds.length} ${action.entryIds.length === 1 ? "entry" : "entries"} in ${action.slug}`,
        detail: `Tags: ${action.tags.join(", ")} · appended as an annotation, the log isn't rewritten`,
      };
    case "move_entries":
      return {
        title: `Move ${action.entryIds.length} ${action.entryIds.length === 1 ? "entry" : "entries"}: ${action.sourceSlug} → ${action.targetSlug}`,
        detail: "Copied into the target with provenance; a marker is appended in the source. Originals stay in the log.",
      };
    case "write_synthesis":
      return {
        title: `Write synthesis "${action.title}" into ${action.slug}`,
        detail: `References ${action.sources.length} source ${action.sources.length === 1 ? "entry" : "entries"}: ${action.content.slice(0, 200)}${action.content.length > 200 ? "…" : ""}`,
      };
  }
}

const STATUS_VARIANT: Record<StoredPlan["status"], "default" | "secondary" | "destructive" | "outline"> = {
  pending: "default",
  running: "secondary",
  done: "outline",
  failed: "destructive",
  rejected: "outline",
};

function ActionRow({ action }: { action: StoredPlanAction }) {
  const { title, detail } = describe(action.payload);
  return (
    <li className="rounded-lg border border-border bg-background/40 p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium">{title}</p>
        {action.status !== "pending" && (
          <Badge variant={action.status === "failed" ? "destructive" : "outline"}>{action.status}</Badge>
        )}
      </div>
      {detail && <p className="mt-1 text-xs text-muted-foreground">{detail}</p>}
      {action.error && <p className="mt-1 text-xs text-destructive">{action.error}</p>}
    </li>
  );
}

export function PlanCard({ plan, onChanged }: { plan: StoredPlan; onChanged: () => void }) {
  const creates = plan.actions.filter((a) => a.payload.type === "create_project");
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Creating a project is never covered by a blanket "approve": each one must
  // have its slug typed out before the Approve button even enables.
  const allConfirmed = creates.every((a) => a.payload.type === "create_project" && typed[a.id]?.trim() === a.payload.slug);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-card/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-tight">{plan.summary}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            proposed by {plan.proposedBy} via {plan.source} · {plan.createdAt}
            {plan.approvedBy ? ` · approved by ${plan.approvedBy}` : ""}
          </p>
        </div>
        <Badge variant={STATUS_VARIANT[plan.status]}>{plan.status}</Badge>
      </div>

      <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">{plan.rationale}</p>
      {plan.citations.length > 0 && (
        <p className="mt-1 text-xs text-muted-foreground">
          Cites: {plan.citations.map((c) => `${c.slug}/${c.entryId}`).join(", ")}
        </p>
      )}

      <ul className="mt-3 space-y-2">
        {plan.actions.map((a) => (
          <ActionRow key={a.id} action={a} />
        ))}
      </ul>

      {plan.error && <p className="mt-2 text-sm text-destructive">{plan.error}</p>}

      {plan.status === "pending" && (
        <div className="mt-4 space-y-3">
          {creates.map((a) =>
            a.payload.type === "create_project" ? (
              <div key={a.id} className="rounded-lg border border-destructive/60 bg-destructive/5 p-3">
                <p className="flex items-center gap-2 text-sm font-semibold text-destructive">
                  <AlertTriangle className="size-4" />
                  This plan wants to create a NEW project
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Creating a project needs your separate, explicit confirmation. Type the slug{" "}
                  <code className="text-foreground">{a.payload.slug}</code> to confirm you want "{a.payload.title}" created.
                </p>
                <Input
                  className="mt-2"
                  placeholder={a.payload.slug}
                  value={typed[a.id] ?? ""}
                  onChange={(e) => setTyped((t) => ({ ...t, [a.id]: e.target.value }))}
                />
              </div>
            ) : null,
          )}
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              className="gap-1.5"
              disabled={busy || !allConfirmed}
              onClick={() => act(() => api.approvePlan(plan.id, typed))}
            >
              <Check className="size-4" />
              Approve &amp; run
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5" disabled={busy} onClick={() => act(() => api.rejectPlan(plan.id))}>
              <X className="size-4" />
              Reject
            </Button>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      )}
    </div>
  );
}

// Everything the assistant (or any MCP/REST client) has proposed. Nothing
// here runs until an admin clicks Approve.
export function PlansPage({ onChanged }: { onChanged?: () => void }) {
  const [plans, setPlans] = useState<StoredPlan[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .listPlans()
      .then((p) => {
        setPlans(p);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load plans"));
  }, []);

  useEffect(load, [load]);

  // A running plan finishes in the background — poll until it settles.
  const anyRunning = plans?.some((p) => p.status === "running") ?? false;
  useEffect(() => {
    if (!anyRunning) return;
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [anyRunning, load]);

  function changed() {
    load();
    onChanged?.();
  }

  const pending = plans?.filter((p) => p.status === "pending") ?? [];
  const rest = plans?.filter((p) => p.status !== "pending") ?? [];

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col gap-4 overflow-y-auto pb-8">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold leading-tight">Plans</h2>
          <p className="text-sm text-muted-foreground">
            Changes proposed by the assistant or an AI client. Nothing runs until you approve it.
          </p>
        </div>
        <Button variant="ghost" size="icon" title="Refresh" aria-label="Refresh" onClick={load}>
          <RefreshCw className="size-4" />
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {plans && plans.length === 0 && <p className="text-sm text-muted-foreground">No plans yet.</p>}

      {pending.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-sm font-medium">Awaiting approval ({pending.length})</h3>
          {pending.map((p) => (
            <PlanCard key={p.id} plan={p} onChanged={changed} />
          ))}
        </section>
      )}
      {rest.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-sm font-medium">History</h3>
          {rest.map((p) => (
            <PlanCard key={p.id} plan={p} onChanged={changed} />
          ))}
        </section>
      )}
    </div>
  );
}

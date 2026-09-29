import { useCallback, useEffect, useState } from "react";
import { api, type SearchStatus } from "@/api";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw } from "lucide-react";

// Admin-only: health of the search index and a manual "Reindex now". Only
// projects with "Include in global search" on are indexed; a nightly cron
// reconciles automatically, this is for when you don't want to wait.
export function SearchIndexCard() {
  const [status, setStatus] = useState<SearchStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(() => {
    api.getSearchStatus().then(setStatus).catch(() => setStatus(null));
  }, []);

  useEffect(load, [load]);

  async function reindex() {
    setBusy(true);
    setMessage(null);
    try {
      const r = await api.reindexSearch();
      setMessage(
        r.projects === 0
          ? "No projects are included in global search yet — turn it on in a project's Edit dialog."
          : `Reindexing ${r.projects} ${r.projects === 1 ? "project" : "projects"} in the background…`,
      );
      // Poll for a bit so the counts visibly catch up.
      for (let i = 0; i < 6; i++) {
        await new Promise((res) => setTimeout(res, 2500));
        load();
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Reindex failed");
    } finally {
      setBusy(false);
    }
  }

  if (!status) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card/40 p-4">
      <div className="min-w-0">
        <p className="text-sm font-semibold leading-tight">Search index</p>
        <p className="text-xs text-muted-foreground">
          {status.eligibleProjects} {status.eligibleProjects === 1 ? "project" : "projects"} included in global search ·{" "}
          {status.indexed} indexed
          {status.pending > 0 ? ` · ${status.pending} pending` : ""}
          {status.failed > 0 ? ` · ${status.failed} failed` : ""}
          {status.vectors && status.keywordOnly > 0 ? ` · ${status.keywordOnly} awaiting vectors` : ""} ·{" "}
          {status.vectors ? "semantic search on" : "keyword-only (no vector binding)"}
        </p>
        {message && <p className="mt-1 text-xs text-muted-foreground">{message}</p>}
      </div>
      <Button size="sm" variant="outline" className="gap-1.5" disabled={busy} onClick={() => void reindex()}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
        Reindex now
      </Button>
    </div>
  );
}

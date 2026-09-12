import { useEffect, useState } from "react";
import { api, type MemoryEntry } from "@/api";
import { EntriesTable } from "@/components/EntriesTable";
import { MemoryGraph } from "@/components/MemoryGraph";
import { ModeToggle } from "@/components/mode-toggle";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Brain } from "lucide-react";

type LoadState = "loading" | "ok" | "not-found" | "error";

/** The minimal, read-only page served at /share/:token. No sidebar, no
 *  Chat tab, no Export, no create-project form — just this one project's
 *  Graph and Entries, fetched from the public token-authed endpoint. */
export function ShareView({ token }: { token: string }) {
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [state, setState] = useState<LoadState>("loading");

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    api
      .getShareMemory(token)
      .then((data) => {
        if (cancelled) return;
        setEntries(data);
        setState("ok");
      })
      .catch((err) => {
        if (cancelled) return;
        const notFound = err instanceof Error && /404|not found/i.test(err.message);
        setState(notFound ? "not-found" : "error");
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
        <Brain className="size-5 shrink-0" />
        <span className="flex-1 text-sm font-medium text-muted-foreground">
          Shared memory — read-only
        </span>
        <ModeToggle />
      </header>
      <main className="min-h-0 flex-1 overflow-hidden p-4">
        {state === "loading" && <p className="text-sm text-muted-foreground">Loading…</p>}
        {state === "not-found" && (
          <p className="text-sm text-muted-foreground">
            This link is invalid or has been revoked.
          </p>
        )}
        {state === "error" && (
          <p className="text-sm text-destructive">Something went wrong loading this project.</p>
        )}
        {state === "ok" && (
          <Tabs defaultValue="graph" className="flex h-full min-h-0 flex-col gap-3">
            <TabsList>
              <TabsTrigger value="graph">Graph</TabsTrigger>
              <TabsTrigger value="entries">Entries</TabsTrigger>
            </TabsList>
            <TabsContent value="graph" className="min-h-0 flex-1">
              <MemoryGraph entries={entries} />
            </TabsContent>
            <TabsContent value="entries" className="min-h-0 flex-1">
              <EntriesTable entries={entries} />
            </TabsContent>
          </Tabs>
        )}
      </main>
    </div>
  );
}

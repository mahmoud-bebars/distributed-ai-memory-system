import { useEffect, useState } from "react";
import { api, type MemoryEntry, type ShareMeta } from "@/api";
import { ChatPanel } from "@/components/ChatPanel";
import { DocsPanel } from "@/components/DocsPanel";
import { EntriesTable } from "@/components/EntriesTable";
import { type GraphFocusRequest, MemoryGraph } from "@/components/MemoryGraph";
import { ModeToggle } from "@/components/mode-toggle";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MessageCircle, Sparkles } from "lucide-react";

type LoadState = "loading" | "ok" | "not-found" | "error";

/** The minimal, read-only page served at /share/:token. No project
 *  switcher, no create-project form, no mutating controls anywhere — just
 *  whatever this specific link was configured to expose. Graph and
 *  Entries are always included; Docs and Chat are per-link opt-in
 *  (`meta.allowDocs`/`meta.allowChat`, fetched before anything else so the
 *  tab list itself never offers something the token isn't allowed to see).
 *  DocsPanel's `source: { kind: "share" }` hides every mutating control
 *  (edit/delete/append/new) — the backend also only exposes GET on the
 *  share-token doc routes, so this is a UI convenience on top of a real
 *  server-side restriction, not the only thing enforcing it. Same idea for
 *  chat: ChatService never offers the model update_doc/delete_doc tools
 *  for a share-scoped question, so there's nothing here to approve/reject
 *  even though ChatPanel supports that flow for the authenticated view. */
export function ShareView({ token }: { token: string }) {
  const [meta, setMeta] = useState<ShareMeta | null>(null);
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [docFilenames, setDocFilenames] = useState<string[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [focusRequest, setFocusRequest] = useState<GraphFocusRequest | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState("loading");

    api
      .getShareMeta(token)
      .then(async (m) => {
        if (cancelled) return;
        setMeta(m);
        const [memoryEntries, docs] = await Promise.all([
          api.getShareMemory(token),
          m.allowDocs ? api.getShareDocs(token) : Promise.resolve({ filenames: [] }),
        ]);
        if (cancelled) return;
        setEntries(memoryEntries);
        setDocFilenames(docs.filenames);
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

  function handleJumpToEntity(name: string) {
    setFocusRequest({ id: name, nonce: Date.now() });
  }

  const defaultTab = "graph";

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border/60 px-4">
        <span
          className="glow-ring flex size-7 shrink-0 items-center justify-center rounded-lg"
          style={{ "--glow-color": "var(--accent-blue)", backgroundColor: "var(--primary)" } as React.CSSProperties}
        >
          <Sparkles className="size-4 text-primary-foreground" />
        </span>
        <span className="flex-1 truncate text-sm font-medium text-muted-foreground">
          {meta ? `${meta.project.title} — shared, read-only` : "Shared memory — read-only"}
        </span>
        <ModeToggle />
      </header>
      <main className="min-h-0 flex-1 overflow-hidden p-4">
        {state === "loading" && <p className="text-sm text-muted-foreground">Loading…</p>}
        {state === "not-found" && (
          <p className="text-sm text-muted-foreground">
            This link is invalid, has expired, or has been revoked.
          </p>
        )}
        {state === "error" && (
          <p className="text-sm text-destructive">Something went wrong loading this project.</p>
        )}
        {state === "ok" && meta && (
          <Tabs defaultValue={defaultTab} className="flex h-full min-h-0 flex-col gap-3">
            <TabsList>
              <TabsTrigger value="graph">Graph</TabsTrigger>
              <TabsTrigger value="entries">Entries</TabsTrigger>
              {meta.allowDocs && <TabsTrigger value="docs">Docs</TabsTrigger>}
              {meta.allowChat && (
                <TabsTrigger value="chat" className="gap-1.5">
                  <MessageCircle className="size-3.5" />
                  Chat
                </TabsTrigger>
              )}
            </TabsList>
            <TabsContent value="graph" className="min-h-0 flex-1">
              <MemoryGraph entries={entries} focusRequest={focusRequest} />
            </TabsContent>
            <TabsContent value="entries" className="min-h-0 flex-1">
              <EntriesTable entries={entries} />
            </TabsContent>
            {meta.allowDocs && (
              <TabsContent value="docs" className="min-h-0 flex-1">
                <DocsPanel source={{ kind: "share", token }} />
              </TabsContent>
            )}
            {meta.allowChat && (
              <TabsContent value="chat" className="min-h-0 flex-1">
                <ChatPanel
                  entries={entries}
                  docFilenames={docFilenames}
                  onJumpToEntity={handleJumpToEntity}
                  ask={(question, docFilename) => api.askShareChat(token, question, docFilename)}
                />
              </TabsContent>
            )}
          </Tabs>
        )}
      </main>
    </div>
  );
}

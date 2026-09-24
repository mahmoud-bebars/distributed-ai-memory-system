import { useCallback, useEffect, useRef, useState } from "react";
import type { PanelImperativeHandle } from "react-resizable-panels";
import { api, type MemoryEntry, type Project } from "@/api";
import { ChatPanel } from "@/components/ChatPanel";
import { DocsPanel } from "@/components/DocsPanel";
import { EntriesTable } from "@/components/EntriesTable";
import { type GraphFocusRequest, MemoryGraph } from "@/components/MemoryGraph";
import { PromptsPanel } from "@/components/PromptsPanel";
import { ShareDialog } from "@/components/ShareDialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useIsMobile } from "@/hooks/use-mobile";
import { useKeySequence } from "@/hooks/use-key-sequence";
import { downloadBlob, downloadJson } from "@/lib/export";
import {
  Download,
  MessageCircle,
  Minimize2,
  Network,
  Maximize2,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  ScrollText,
} from "lucide-react";

type CenterTab = "graph" | "list" | "prompts";
type RightTab = "chat" | "docs";

export function ProjectView({ project }: { project: Project }) {
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [docCount, setDocCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [centerTab, setCenterTab] = useState<CenterTab>("graph");
  const [rightTab, setRightTab] = useState<RightTab>("chat");
  const [expanded, setExpanded] = useState(false);
  const [focusRequest, setFocusRequest] = useState<GraphFocusRequest | null>(null);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const rightPanelRef = useRef<PanelImperativeHandle>(null);
  const isMobile = useIsMobile();

  const fetchMemory = useCallback(() => {
    setLoading(true);
    setError(null);
    return api
      .getMemory(project.slug)
      .then(setEntries)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load memory."))
      .finally(() => setLoading(false));
  }, [project.slug]);

  // Chat dumps every doc into its context alongside memory (ChatService.ask)
  // with no picker to select among them — this count is purely so the Chat
  // tab can tell the user that's happening, not something the user narrows.
  const fetchDocCount = useCallback(() => {
    return api
      .getDocs(project.slug)
      .then((r) => setDocCount(r.filenames.length))
      .catch(() => {
        // Non-critical for the rest of the page — the Chat tab just won't
        // show a doc count if this fails, memory still loads independently.
      });
  }, [project.slug]);

  useEffect(() => {
    fetchMemory();
    fetchDocCount();
    setExpanded(false);
    setCenterTab("graph");
    setRightTab("chat");
  }, [fetchMemory, fetchDocCount]);

  useEffect(() => {
    if (!expanded) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setExpanded(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [expanded]);

  // "G" then "L" toggles the center panel between the graph and the list
  // (entries table) view — jumping straight past Prompts either direction.
  useKeySequence(
    ["g", "l"],
    () => setCenterTab((t) => (t === "list" ? "graph" : "list")),
    true
  );

  function handleJumpToEntity(name: string) {
    setCenterTab("graph");
    setFocusRequest({ id: name, nonce: Date.now() });
  }

  function toggleRightPanel() {
    const panel = rightPanelRef.current;
    if (!panel) return;
    if (panel.isCollapsed()) panel.expand();
    else panel.collapse();
  }

  async function handleRawExport() {
    try {
      const blob = await api.downloadMemoryRaw(project.slug);
      downloadBlob(`${project.slug}-memory.jsonl`, blob);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to export memory.");
    }
  }

  function handleJsonExport() {
    downloadJson(`${project.slug}-memory.json`, entries);
  }

  const centerPanel = (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col gap-3 rounded-2xl border border-border bg-card/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className="glow-ring flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/15"
            style={{ "--glow-color": "var(--accent-blue)" } as React.CSSProperties}
          >
            <Network className="size-4 text-primary" />
          </span>
          <div>
            <h3 className="text-sm font-semibold leading-tight">Memory Graph</h3>
            <p className="text-xs text-muted-foreground">
              Explore how this project's memory is connected
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Tabs value={centerTab} onValueChange={(v) => setCenterTab(v as CenterTab)}>
            <TabsList>
              <TabsTrigger value="graph">Graph</TabsTrigger>
              <TabsTrigger value="list">List</TabsTrigger>
              <TabsTrigger value="prompts">Prompts</TabsTrigger>
            </TabsList>
          </Tabs>
          {!isMobile && !expanded && (
            <Button
              variant="outline"
              size="icon-sm"
              title={rightCollapsed ? "Show side panel" : "Hide side panel"}
              onClick={toggleRightPanel}
            >
              {rightCollapsed ? (
                <PanelRightOpen className="size-4" />
              ) : (
                <PanelRightClose className="size-4" />
              )}
            </Button>
          )}
          <Button
            variant="outline"
            size="icon-sm"
            title={expanded ? "Exit fullscreen" : "Fullscreen"}
            onClick={() => setExpanded((e) => !e)}
          >
            {expanded ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {centerTab === "graph" && <MemoryGraph entries={entries} focusRequest={focusRequest} />}
        {centerTab === "list" && <EntriesTable entries={entries} />}
        {centerTab === "prompts" && (
          <div className="h-full overflow-y-auto">
            <PromptsPanel slug={project.slug} />
          </div>
        )}
      </div>
    </div>
  );

  const rightPanel = (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col gap-3 rounded-2xl border border-border bg-card/40 p-3">
      <Tabs
        value={rightTab}
        onValueChange={(v) => setRightTab(v as RightTab)}
        className="flex min-h-0 flex-1 flex-col gap-3"
      >
        <TabsList variant="line" className="w-full justify-start border-b border-border pb-0">
          <TabsTrigger value="chat" className="gap-1.5">
            <MessageCircle className="size-3.5" />
            Chat
          </TabsTrigger>
          <TabsTrigger value="docs" className="gap-1.5">
            <ScrollText className="size-3.5" />
            Docs {docCount > 0 && <span className="text-muted-foreground">({docCount})</span>}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="chat" className="min-h-0 flex-1">
          <ChatPanel
            slug={project.slug}
            entries={entries}
            docCount={docCount}
            onJumpToEntity={handleJumpToEntity}
          />
        </TabsContent>
        <TabsContent value="docs" className="min-h-0 flex-1">
          <DocsPanel source={{ kind: "project", slug: project.slug }} />
        </TabsContent>
      </Tabs>
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold leading-tight">{project.title}</h2>
          {project.summary && <p className="text-sm text-muted-foreground">{project.summary}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            title="Refresh memory and docs"
            onClick={() => {
              fetchMemory();
              fetchDocCount();
            }}
            disabled={loading}
          >
            <RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} />
          </Button>
          <ShareDialog slug={project.slug} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                <Download className="size-4" />
                Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={handleRawExport}>
                Raw memory.jsonl (backup-accurate)
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={handleJsonExport}>
                Pretty JSON (current view)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {expanded ? (
        <div className="fixed inset-4 z-50 flex flex-col gap-3 rounded-2xl bg-background p-3 shadow-2xl ring-1 ring-border">
          {centerPanel}
        </div>
      ) : isMobile ? (
        <div className="grid min-h-0 flex-1 grid-rows-[minmax(320px,1fr)_420px] gap-4">
          {centerPanel}
          {rightPanel}
        </div>
      ) : (
        // Desktop only — dragging the handle resizes both panels, and the
        // "hide side panel" button in the center header collapses/expands
        // the right one via rightPanelRef. Mobile keeps the fixed-row grid
        // above: dragging a horizontal split on a narrow touch screen isn't
        // a good interaction, so it isn't offered there.
        <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
          <ResizablePanel id="center-panel" defaultSize={65} minSize={35}>
            {centerPanel}
          </ResizablePanel>
          <ResizableHandle withHandle className="mx-2" />
          <ResizablePanel
            id="right-panel"
            defaultSize={35}
            minSize={22}
            collapsible
            collapsedSize={0}
            panelRef={rightPanelRef}
            onResize={(size) => setRightCollapsed(size.asPercentage < 1)}
          >
            {rightPanel}
          </ResizablePanel>
        </ResizablePanelGroup>
      )}
    </div>
  );
}

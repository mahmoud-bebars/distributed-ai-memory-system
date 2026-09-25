import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PanelImperativeHandle } from "react-resizable-panels";
import { api, type MemoryEntry, type Project } from "@/api";
import { ChatPanel } from "@/components/ChatPanel";
import { DocsPanel } from "@/components/DocsPanel";
import { EditProjectDialog } from "@/components/EditProjectDialog";
import { EntriesTable } from "@/components/EntriesTable";
import { type GraphFocusRequest, MemoryGraph } from "@/components/MemoryGraph";
import { PromptsPanel } from "@/components/PromptsPanel";
import { ShareDialog } from "@/components/ShareDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useIsMobile } from "@/hooks/use-mobile";
import { useKeySequence } from "@/hooks/use-key-sequence";
import { downloadBlob, downloadJson } from "@/lib/export";
import { parseTags } from "@/lib/tags";
import {
  Download,
  MessageCircle,
  Minimize2,
  MoreVertical,
  Network,
  Maximize2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  RefreshCw,
  ScrollText,
  Share2,
  Wand2,
} from "lucide-react";

type CenterTab = "graph" | "list";
type RightTab = "chat" | "docs";

export function ProjectView({
  project,
  onProjectUpdated,
}: {
  project: Project;
  onProjectUpdated: (project: Project) => void;
}) {
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [docFilenames, setDocFilenames] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [centerTab, setCenterTab] = useState<CenterTab>("graph");
  const [rightTab, setRightTab] = useState<RightTab>("chat");
  // Which panel (if either) is blown up to fill the whole view — mutually
  // exclusive with the resizable split below.
  const [expandedPanel, setExpandedPanel] = useState<"center" | "right" | null>(
    null,
  );
  const [focusRequest, setFocusRequest] = useState<GraphFocusRequest | null>(
    null,
  );
  const [centerCollapsed, setCenterCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [promptsOpen, setPromptsOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const centerPanelRef = useRef<PanelImperativeHandle>(null);
  const rightPanelRef = useRef<PanelImperativeHandle>(null);
  const isMobile = useIsMobile();
  const tags = useMemo(() => parseTags(project.tags), [project.tags]);
  const docCount = docFilenames.length;

  const fetchMemory = useCallback(() => {
    setLoading(true);
    setError(null);
    return api
      .getMemory(project.slug)
      .then(setEntries)
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Failed to load memory."),
      )
      .finally(() => setLoading(false));
  }, [project.slug]);

  // Chat dumps every doc into its context alongside memory by default
  // (ChatService.ask) — the filenames here back both that doc count and
  // ChatPanel's doc-picker popover, which lets a question scope down to one.
  const fetchDocCount = useCallback(() => {
    return api
      .getDocs(project.slug)
      .then((r) => setDocFilenames(r.filenames))
      .catch(() => {
        // Non-critical for the rest of the page — the Chat tab just won't
        // show a doc count if this fails, memory still loads independently.
      });
  }, [project.slug]);

  useEffect(() => {
    fetchMemory();
    fetchDocCount();
    setExpandedPanel(null);
    setCenterTab("graph");
    setRightTab("chat");
  }, [fetchMemory, fetchDocCount]);

  useEffect(() => {
    if (!expandedPanel) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setExpandedPanel(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [expandedPanel]);

  // "G" then "L" toggles the center panel between the graph and the list
  // (entries table) view.
  useKeySequence(
    ["g", "l"],
    () => setCenterTab((t) => (t === "list" ? "graph" : "list")),
    true,
  );

  function handleJumpToEntity(name: string) {
    setCenterTab("graph");
    setFocusRequest({ id: name, nonce: Date.now() });
  }

  function toggleCenterPanel() {
    const panel = centerPanelRef.current;
    if (!panel) return;
    if (panel.isCollapsed()) panel.expand();
    else panel.collapse();
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
            style={
              { "--glow-color": "var(--accent-blue)" } as React.CSSProperties
            }
          >
            <Network className="size-4 text-primary" />
          </span>
          <div>
            <h3 className="text-sm font-semibold leading-tight">
              Memory Graph
            </h3>
            <p className="text-xs text-muted-foreground">
              Explore how this project's memory is connected
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Tabs
            value={centerTab}
            onValueChange={(v) => setCenterTab(v as CenterTab)}
          >
            <TabsList>
              <TabsTrigger value="graph">Graph</TabsTrigger>
              <TabsTrigger value="list">List</TabsTrigger>
            </TabsList>
          </Tabs>
          {!isMobile && !expandedPanel && (
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
            title={
              expandedPanel === "center" ? "Exit fullscreen" : "Fullscreen"
            }
            onClick={() =>
              setExpandedPanel((p) => (p === "center" ? null : "center"))
            }
          >
            {expandedPanel === "center" ? (
              <Minimize2 className="size-4" />
            ) : (
              <Maximize2 className="size-4" />
            )}
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {centerTab === "graph" && (
          <MemoryGraph entries={entries} focusRequest={focusRequest} />
        )}
        {centerTab === "list" && <EntriesTable entries={entries} />}
      </div>
    </div>
  );

  const rightPanel = (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col gap-3 rounded-2xl border border-border bg-card/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className="glow-ring flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/15"
            style={
              { "--glow-color": "var(--accent-violet)" } as React.CSSProperties
            }
          >
            <MessageCircle className="size-4 text-primary" />
          </span>
          <div>
            <h3 className="text-sm font-semibold leading-tight">
              Chat &amp; Docs
            </h3>
            <p className="text-xs text-muted-foreground">
              Ask questions or browse project docs
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!isMobile && !expandedPanel && (
            <Button
              variant="outline"
              size="icon-sm"
              title={centerCollapsed ? "Show graph panel" : "Hide graph panel"}
              onClick={toggleCenterPanel}
            >
              {centerCollapsed ? (
                <PanelLeftOpen className="size-4" />
              ) : (
                <PanelLeftClose className="size-4" />
              )}
            </Button>
          )}
          <Button
            variant="outline"
            size="icon-sm"
            title={expandedPanel === "right" ? "Exit fullscreen" : "Fullscreen"}
            onClick={() =>
              setExpandedPanel((p) => (p === "right" ? null : "right"))
            }
          >
            {expandedPanel === "right" ? (
              <Minimize2 className="size-4" />
            ) : (
              <Maximize2 className="size-4" />
            )}
          </Button>
        </div>
      </div>
      <Tabs
        value={rightTab}
        onValueChange={(v) => setRightTab(v as RightTab)}
        className="flex min-h-0 flex-1 flex-col gap-3"
      >
        <TabsList
          variant="line"
          className="w-full justify-start border-b border-border pb-0"
        >
          <TabsTrigger value="chat" className="gap-1.5">
            <MessageCircle className="size-3.5" />
            Chat
          </TabsTrigger>
          <TabsTrigger value="docs" className="gap-1.5">
            <ScrollText className="size-3.5" />
            Docs{" "}
            {docCount > 0 && (
              <span className="text-muted-foreground">({docCount})</span>
            )}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="chat" className="min-h-0 flex-1">
          <ChatPanel
            slug={project.slug}
            entries={entries}
            docFilenames={docFilenames}
            onJumpToEntity={handleJumpToEntity}
            ask={(question, docFilename) =>
              api.askChat(project.slug, question, docFilename)
            }
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
        <div className="flex items-start gap-2">
          <div>
            <h2 className="text-lg font-semibold leading-tight">
              {project.title}
            </h2>
            {project.summary && (
              <p className="text-sm text-muted-foreground">{project.summary}</p>
            )}
            {tags.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {tags.map((tag) => (
                  <Badge key={tag} variant="outline">
                    {tag}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                title="Project actions"
                aria-label="Project actions"
              >
                <MoreVertical className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuItem onSelect={() => setEditOpen(true)}>
                <Pencil className="size-4" />
                Edit project
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={loading}
                onSelect={() => {
                  fetchMemory();
                  fetchDocCount();
                }}
              >
                <RefreshCw
                  className={loading ? "size-4 animate-spin" : "size-4"}
                />
                Refresh memory and docs
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setShareOpen(true)}>
                <Share2 className="size-4" />
                Share project…
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setPromptsOpen(true)}>
                <Wand2 className="size-4" />
                Prompts
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={handleRawExport}>
                <Download className="size-4" />
                Export raw memory.jsonl
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={handleJsonExport}>
                <Download className="size-4" />
                Export pretty JSON
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <EditProjectDialog
        project={project}
        open={editOpen}
        onOpenChange={setEditOpen}
        onUpdated={onProjectUpdated}
      />
      <ShareDialog
        slug={project.slug}
        open={shareOpen}
        onOpenChange={setShareOpen}
      />

      {error && <p className="text-sm text-destructive">{error}</p>}

      {expandedPanel ? (
        <div className="fixed inset-4 z-50 flex flex-col gap-3 rounded-2xl bg-background p-3 shadow-2xl ring-1 ring-border">
          {expandedPanel === "center" ? centerPanel : rightPanel}
        </div>
      ) : isMobile ? (
        <div className="grid min-h-0 flex-1 grid-rows-[minmax(320px,1fr)_420px] gap-4">
          {centerPanel}
          {rightPanel}
        </div>
      ) : (
        // Desktop only — dragging the handle resizes both panels, and each
        // panel's "hide other panel" button collapses/expands its sibling
        // via the other's panelRef. Mobile keeps the fixed-row grid above:
        // dragging a horizontal split on a narrow touch screen isn't a good
        // interaction, so it isn't offered there.
        <ResizablePanelGroup
          orientation="horizontal"
          className="min-h-0 flex-1"
        >
          <ResizablePanel
            id="center-panel"
            defaultSize={65}
            minSize={35}
            collapsible
            collapsedSize={0}
            panelRef={centerPanelRef}
            onResize={(size) => setCenterCollapsed(size.asPercentage < 1)}
          >
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

      <Sheet open={promptsOpen} onOpenChange={setPromptsOpen}>
        <SheetContent className="overflow-y-auto w-full min-w-full">
          <SheetHeader>
            <SheetTitle>Prompts</SheetTitle>
            <SheetDescription>
              Seed or sync this project's memory from Claude Code.
            </SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-4">
            <PromptsPanel slug={project.slug} />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

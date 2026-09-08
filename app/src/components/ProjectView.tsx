import { useCallback, useEffect, useState } from "react";
import { api, type MemoryEntry, type Project } from "@/api";
import { ChatPanel } from "@/components/ChatPanel";
import { EntriesTable } from "@/components/EntriesTable";
import { MemoryGraph } from "@/components/MemoryGraph";
import { PromptsPanel } from "@/components/PromptsPanel";
import { ShareDialog } from "@/components/ShareDialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { downloadBlob, downloadJson } from "@/lib/export";
import { Download, RefreshCw } from "lucide-react";

export function ProjectView({ project }: { project: Project }) {
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchMemory = useCallback(() => {
    setLoading(true);
    setError(null);
    return api
      .getMemory(project.slug)
      .then(setEntries)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load memory."))
      .finally(() => setLoading(false));
  }, [project.slug]);

  useEffect(() => {
    fetchMemory();
  }, [fetchMemory]);

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
            title="Refresh memory"
            onClick={() => fetchMemory()}
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

      <Tabs defaultValue="graph" className="flex min-h-0 flex-1 flex-col gap-3">
        <TabsList>
          <TabsTrigger value="graph">Graph</TabsTrigger>
          <TabsTrigger value="entries">Entries</TabsTrigger>
          <TabsTrigger value="chat">Chat</TabsTrigger>
          <TabsTrigger value="prompts">Prompts</TabsTrigger>
        </TabsList>
        <TabsContent value="graph" className="min-h-0 flex-1">
          <MemoryGraph entries={entries} />
        </TabsContent>
        <TabsContent value="entries" className="min-h-0 flex-1">
          <EntriesTable entries={entries} />
        </TabsContent>
        <TabsContent value="chat" className="min-h-0 flex-1">
          <ChatPanel slug={project.slug} entryCount={entries.length} />
        </TabsContent>
        <TabsContent value="prompts" className="min-h-0 flex-1 overflow-y-auto">
          <PromptsPanel slug={project.slug} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

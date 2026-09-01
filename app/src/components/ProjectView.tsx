import { useEffect, useState } from "react";
import { api, type MemoryEntry, type Project } from "@/api";
import { ChatPanel } from "@/components/ChatPanel";
import { EntriesTable } from "@/components/EntriesTable";
import { MemoryGraph } from "@/components/MemoryGraph";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { downloadBlob, downloadJson } from "@/lib/export";
import { Download } from "lucide-react";

export function ProjectView({ project }: { project: Project }) {
  const [entries, setEntries] = useState<MemoryEntry[]>([]);

  useEffect(() => {
    api
      .getMemory(project.slug)
      .then(setEntries)
      .catch(() => setEntries([]));
  }, [project.slug]);

  async function handleRawExport() {
    const blob = await api.downloadMemoryRaw(project.slug);
    downloadBlob(`${project.slug}-memory.jsonl`, blob);
  }

  function handleJsonExport() {
    downloadJson(`${project.slug}-memory.json`, entries);
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold leading-tight">{project.title}</h2>
          {project.summary && <p className="text-sm text-muted-foreground">{project.summary}</p>}
        </div>
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

      <Tabs defaultValue="graph" className="flex min-h-0 flex-1 flex-col gap-3">
        <TabsList>
          <TabsTrigger value="graph">Graph</TabsTrigger>
          <TabsTrigger value="entries">Entries</TabsTrigger>
          <TabsTrigger value="chat">Chat</TabsTrigger>
        </TabsList>
        <TabsContent value="graph" className="min-h-0 flex-1">
          <MemoryGraph entries={entries} />
        </TabsContent>
        <TabsContent value="entries" className="min-h-0 flex-1">
          <EntriesTable entries={entries} />
        </TabsContent>
        <TabsContent value="chat" className="min-h-0 flex-1">
          <ChatPanel slug={project.slug} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

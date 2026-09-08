import { useMemo, useState } from "react";
import type { Project } from "@/api";
import { CreateProjectDialog } from "@/components/CreateProjectDialog";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInput,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Brain, BookOpen } from "lucide-react";

export function AppSidebar({
  projects,
  selected,
  onSelect,
  onCreated,
  onGuide,
  guideActive,
}: {
  projects: Project[];
  selected: string | null;
  onSelect: (slug: string) => void;
  onCreated: (slug: string) => void;
  onGuide: () => void;
  guideActive: boolean;
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) => p.title.toLowerCase().includes(q) || p.slug.includes(q));
  }, [projects, query]);

  return (
    <Sidebar>
      <SidebarHeader className="gap-3 px-3 pt-3">
        <div className="flex items-center gap-2 px-1">
          <Brain className="size-5 shrink-0" />
          <span className="text-sm font-semibold leading-tight">Distributed AI Memory</span>
        </div>
        <SidebarInput
          placeholder="Search projects…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {filtered.length === 0 ? (
                <p className="px-2 py-4 text-sm text-muted-foreground">
                  {projects.length === 0 ? "No projects yet." : "No matches."}
                </p>
              ) : (
                filtered.map((project) => (
                  <SidebarMenuItem key={project.slug}>
                    <SidebarMenuButton
                      isActive={!guideActive && project.slug === selected}
                      onClick={() => onSelect(project.slug)}
                      className="h-auto flex-col items-start gap-0.5 py-2"
                    >
                      <span className="w-full truncate text-sm font-medium">{project.title}</span>
                      <span className="text-xs text-muted-foreground">
                        {project.entityCount} entries
                      </span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="gap-2 p-3">
        <Button
          variant={guideActive ? "secondary" : "ghost"}
          size="sm"
          className="w-full justify-start gap-2"
          onClick={onGuide}
        >
          <BookOpen className="size-4" />
          Guide
        </Button>
        <CreateProjectDialog onCreated={onCreated} />
      </SidebarFooter>
    </Sidebar>
  );
}

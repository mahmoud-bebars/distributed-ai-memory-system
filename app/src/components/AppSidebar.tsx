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
import { accentVar, hueFor } from "@/lib/palette";
import { cn } from "@/lib/utils";
import { BookOpen, Plus, Sparkles } from "lucide-react";

export const SIDEBAR_SEARCH_ID = "project-search-input";

function ProjectIcon({ slug, title }: { slug: string; title: string }) {
  const color = accentVar(hueFor(slug));
  const initial = title.trim().charAt(0).toUpperCase() || "?";
  return (
    <span
      className="glow-ring flex size-10 shrink-0 items-center justify-center rounded-xl text-sm font-semibold"
      style={
        {
          "--glow-color": color,
          backgroundColor: `color-mix(in oklch, ${color} 22%, var(--card))`,
          color,
        } as React.CSSProperties
      }
    >
      {initial}
    </span>
  );
}

function subtitleFor(project: Project): string {
  if (project.summary && project.summary.trim()) return project.summary;
  const tags = project.tags
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  return tags.length > 0 ? tags.join(", ") : "No description yet";
}

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
  const [createOpen, setCreateOpen] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) => p.title.toLowerCase().includes(q) || p.slug.includes(q));
  }, [projects, query]);

  return (
    <Sidebar>
      <SidebarHeader className="gap-3 px-3 pt-3">
        <div className="flex items-center gap-2 px-1">
          <span
            className="glow-ring flex size-7 shrink-0 items-center justify-center rounded-lg"
            style={{ "--glow-color": "var(--accent-blue)", backgroundColor: "var(--primary)" } as React.CSSProperties}
          >
            <Sparkles className="size-4 text-primary-foreground" />
          </span>
          <span className="text-sm font-semibold leading-tight">Distributed AI Memory</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="relative flex-1">
            <SidebarInput
              id={SIDEBAR_SEARCH_ID}
              placeholder="Search projects…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pr-10"
            />
            <kbd className="pointer-events-none absolute top-1/2 right-1.5 -translate-y-1/2 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              ⌘K
            </kbd>
          </div>
          <Button
            variant="outline"
            size="icon"
            title="New project"
            aria-label="New project"
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="size-4" />
          </Button>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu className="gap-1">
              {filtered.length === 0 ? (
                <p className="px-2 py-4 text-sm text-muted-foreground">
                  {projects.length === 0 ? "No projects yet." : "No matches."}
                </p>
              ) : (
                filtered.map((project) => {
                  const isActive = !guideActive && project.slug === selected;
                  return (
                    <SidebarMenuItem key={project.slug}>
                      <SidebarMenuButton
                        isActive={isActive}
                        onClick={() => onSelect(project.slug)}
                        className={cn(
                          "h-auto items-center gap-3 rounded-xl px-2 py-2",
                          isActive && "bg-sidebar-accent"
                        )}
                      >
                        <ProjectIcon slug={project.slug} title={project.title} />
                        <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
                          <span className="w-full truncate text-sm font-medium">
                            {project.title}
                          </span>
                          <span className="w-full truncate text-xs text-muted-foreground">
                            {subtitleFor(project)}
                          </span>
                        </span>
                        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
                          {project.entityCount}
                        </span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })
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
      </SidebarFooter>
      <CreateProjectDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={onCreated}
        hideTrigger
      />
    </Sidebar>
  );
}

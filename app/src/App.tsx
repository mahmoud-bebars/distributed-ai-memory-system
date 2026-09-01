import { useEffect, useMemo, useState } from "react";
import { api, type Project } from "@/api";
import { AppSidebar } from "@/components/AppSidebar";
import { ProjectView } from "@/components/ProjectView";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState<string | null>(null);

  function refreshProjects() {
    api.listProjects().then(setProjects).catch(() => setProjects([]));
  }

  useEffect(() => {
    refreshProjects();
  }, []);

  const selectedProject = useMemo(
    () => projects.find((p) => p.slug === selected) ?? null,
    [projects, selected]
  );

  return (
    <SidebarProvider>
      <AppSidebar
        projects={projects}
        selected={selected}
        onSelect={setSelected}
        onCreated={(slug) => {
          refreshProjects();
          setSelected(slug);
        }}
      />
      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger />
          <Separator orientation="vertical" className="h-6" />
          <h1 className="text-sm font-medium text-muted-foreground">
            Distributed AI Memory System
          </h1>
        </header>
        <main className="min-h-0 flex-1 overflow-hidden p-4">
          {selectedProject ? (
            <ProjectView project={selectedProject} />
          ) : (
            <p className="text-sm text-muted-foreground">
              Select a project from the sidebar, or create one.
            </p>
          )}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}

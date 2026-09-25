import { useEffect, useMemo, useState } from "react";
import { api, type Project } from "@/api";
import { CreateProjectPage } from "@/components/CreateProjectPage";
import { GuidePage } from "@/components/GuidePage";
import { ModeToggle } from "@/components/mode-toggle";
import { ProjectSwitcher } from "@/components/ProjectSwitcher";
import { ProjectsOverview } from "@/components/ProjectsOverview";
import { ProjectView } from "@/components/ProjectView";
import { ShortcutsHelp } from "@/components/ShortcutsHelp";
import { Button } from "@/components/ui/button";
import { BookOpen, Brain } from "lucide-react";

type View = "browse" | "guide" | "create";

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<View>("browse");
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  function refreshProjects() {
    api
      .listProjects()
      .then(setProjects)
      .catch(() => setProjects([]));
  }

  useEffect(() => {
    refreshProjects();
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const isMod = event.metaKey || event.ctrlKey;
      if (isMod && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSwitcherOpen(true);
        return;
      }
      if ((isMod && event.key === "/") || (!isMod && event.key === "?")) {
        event.preventDefault();
        setShortcutsOpen(true);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const selectedProject = useMemo(
    () => projects.find((p) => p.slug === selected) ?? null,
    [projects, selected],
  );

  function selectProject(slug: string) {
    setSelected(slug);
    setView("browse");
  }

  function handleCreated(slug: string) {
    refreshProjects();
    setSelected(slug);
    setView("browse");
  }

  function handleProjectUpdated(updated: Project) {
    setProjects((prev) =>
      prev.map((p) => (p.slug === updated.slug ? updated : p)),
    );
  }

  const headerTitle =
    view === "create"
      ? "New project"
      : view === "guide"
      ? "Guide"
      : selectedProject?.title ?? "DAMS";

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border/60 px-4">
        <Button
          className="glow-ring flex size-7 shrink-0 items-center justify-center rounded-lg"
          style={
            {
              "--glow-color": "var(--accent-blue)",
              backgroundColor: "var(--primary)",
            } as React.CSSProperties
          }
          onClick={() => setView("browse")}
        >
          <Brain className="size-4 text-primary-foreground" />
        </Button>
        <ProjectSwitcher
          projects={projects}
          selected={selected}
          onSelect={selectProject}
          onCreate={() => setView("create")}
          open={switcherOpen}
          onOpenChange={setSwitcherOpen}
        />
        <h1 className="flex-1 truncate text-sm font-medium text-muted-foreground">
          {headerTitle}
        </h1>
        <Button
          variant={view === "guide" ? "secondary" : "ghost"}
          size="icon"
          title="Guide"
          aria-label="Guide"
          onClick={() => setView((v) => (v === "guide" ? "browse" : "guide"))}
        >
          <BookOpen className="size-4" />
        </Button>
        <ModeToggle />
      </header>
      <main className="min-h-0 flex-1 overflow-hidden p-4">
        {view === "guide" ? (
          <GuidePage />
        ) : view === "create" ? (
          <CreateProjectPage
            onCreated={handleCreated}
            onCancel={() => setView("browse")}
          />
        ) : selectedProject ? (
          <ProjectView
            project={selectedProject}
            onProjectUpdated={handleProjectUpdated}
          />
        ) : (
          <ProjectsOverview
            projects={projects}
            onSelect={selectProject}
            onCreate={() => setView("create")}
          />
        )}
      </main>
      <ShortcutsHelp open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </div>
  );
}

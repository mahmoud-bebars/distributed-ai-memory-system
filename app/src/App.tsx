import { useEffect, useMemo, useState } from "react";
import { api, type Project } from "@/api";
import { AppSidebar, SIDEBAR_SEARCH_ID } from "@/components/AppSidebar";
import { GuidePage } from "@/components/GuidePage";
import { ModeToggle } from "@/components/mode-toggle";
import { ProjectView } from "@/components/ProjectView";
import { ShortcutsHelp } from "@/components/ShortcutsHelp";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";

// Lives inside SidebarProvider so it can reach useSidebar() to open the
// mobile sheet before focusing the (otherwise offscreen) search input.
function GlobalShortcuts({ onHelp }: { onHelp: () => void }) {
  const { isMobile, setOpenMobile, setOpen } = useSidebar();

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const isMod = event.metaKey || event.ctrlKey;
      if (isMod && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (isMobile) setOpenMobile(true);
        else setOpen(true);
        requestAnimationFrame(() => {
          document.getElementById(SIDEBAR_SEARCH_ID)?.focus();
        });
        return;
      }
      if ((isMod && event.key === "/") || (!isMod && event.key === "?")) {
        event.preventDefault();
        onHelp();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isMobile, setOpenMobile, setOpen, onHelp]);

  return null;
}

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

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
      <GlobalShortcuts onHelp={() => setShortcutsOpen(true)} />
      <AppSidebar
        projects={projects}
        selected={selected}
        onSelect={(slug) => {
          setShowGuide(false);
          setSelected(slug);
        }}
        onCreated={(slug) => {
          refreshProjects();
          setShowGuide(false);
          setSelected(slug);
        }}
        onGuide={() => setShowGuide(true)}
        guideActive={showGuide}
      />
      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border/60 px-4">
          <SidebarTrigger />
          <Separator orientation="vertical" className="h-6" />
          <h1 className="flex-1 text-sm font-medium text-muted-foreground">
            Distributed AI Memory System
          </h1>
          <ModeToggle />
        </header>
        <main className="min-h-0 flex-1 overflow-hidden p-4">
          {showGuide ? (
            <GuidePage />
          ) : selectedProject ? (
            <ProjectView project={selectedProject} />
          ) : (
            <p className="text-sm text-muted-foreground">
              Select a project from the sidebar, or create one.
            </p>
          )}
        </main>
      </SidebarInset>
      <ShortcutsHelp open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </SidebarProvider>
  );
}

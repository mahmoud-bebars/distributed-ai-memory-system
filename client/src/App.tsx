import { useEffect, useMemo, useState } from "react";
import { api, type AuthIdentity, type Project } from "@/api";
import { AssistantPage } from "@/components/AssistantPage";
import { CreateProjectPage } from "@/components/CreateProjectPage";
import { GuidePage } from "@/components/GuidePage";
import { ModeToggle } from "@/components/mode-toggle";
import { PlansPage } from "@/components/PlansPage";
import { ProjectSwitcher } from "@/components/ProjectSwitcher";
import { ProjectsOverview } from "@/components/ProjectsOverview";
import { ProjectView } from "@/components/ProjectView";
import { ShortcutsHelp } from "@/components/ShortcutsHelp";
import { TokensPage } from "@/components/TokensPage";
import { Button } from "@/components/ui/button";
import { BookOpen, Brain, ClipboardCheck, KeyRound, LogOut, Sparkles } from "lucide-react";

type View = "browse" | "guide" | "tokens" | "plans" | "assistant" | "create";

export default function App({
  identity,
  onLogout,
}: {
  identity: AuthIdentity;
  onLogout: () => void;
}) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<View>("browse");
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [pendingPlans, setPendingPlans] = useState(0);

  // Pending-approval count for the header badge. Only an admin can approve,
  // so only an admin session asks.
  function refreshPendingPlans() {
    if (identity.scope !== "admin") return;
    api
      .listPlans()
      .then((plans) => setPendingPlans(plans.filter((p) => p.status === "pending").length))
      .catch(() => setPendingPlans(0));
  }

  function refreshProjects() {
    api
      .listProjects()
      .then(setProjects)
      .catch(() => setProjects([]));
  }

  useEffect(() => {
    refreshProjects();
    refreshPendingPlans();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      : view === "tokens"
      ? "Tokens"
      : view === "plans"
      ? "Plans"
      : view === "assistant"
      ? "Assistant"
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
        {identity.scope !== "read_only" && (
          <Button
            variant={view === "assistant" ? "secondary" : "ghost"}
            size="icon"
            title="Assistant"
            aria-label="Assistant"
            onClick={() => setView((v) => (v === "assistant" ? "browse" : "assistant"))}
          >
            <Sparkles className="size-4" />
          </Button>
        )}
        {identity.scope === "admin" && (
          <Button
            variant={view === "plans" ? "secondary" : "ghost"}
            size="icon"
            title="Plans awaiting approval"
            aria-label="Plans"
            className="relative"
            onClick={() => {
              setView((v) => (v === "plans" ? "browse" : "plans"));
              refreshPendingPlans();
            }}
          >
            <ClipboardCheck className="size-4" />
            {pendingPlans > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
                {pendingPlans}
              </span>
            )}
          </Button>
        )}
        {identity.scope === "admin" && (
          <Button
            variant={view === "tokens" ? "secondary" : "ghost"}
            size="icon"
            title="Tokens"
            aria-label="Tokens"
            onClick={() => setView((v) => (v === "tokens" ? "browse" : "tokens"))}
          >
            <KeyRound className="size-4" />
          </Button>
        )}
        <Button variant="ghost" size="icon" title="Log out" aria-label="Log out" onClick={onLogout}>
          <LogOut className="size-4" />
        </Button>
        <ModeToggle />
      </header>
      <main className="min-h-0 flex-1 overflow-hidden p-4">
        {view === "guide" ? (
          <GuidePage />
        ) : view === "tokens" ? (
          <TokensPage />
        ) : view === "assistant" ? (
          <AssistantPage
            onOpenProject={selectProject}
            onPlansChanged={() => {
              refreshPendingPlans();
              refreshProjects();
            }}
          />
        ) : view === "plans" ? (
          <PlansPage
            onChanged={() => {
              refreshPendingPlans();
              refreshProjects();
            }}
          />
        ) : view === "create" ? (
          <CreateProjectPage
            onCreated={handleCreated}
            onCancel={() => setView("browse")}
          />
        ) : selectedProject ? (
          <ProjectView
            isAdmin={identity.scope === "admin"}
            project={selectedProject}
            onProjectUpdated={handleProjectUpdated}
          />
        ) : (
          <ProjectsOverview
            isAdmin={identity.scope === "admin"}
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

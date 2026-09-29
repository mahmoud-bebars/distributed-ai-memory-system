import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, Route, Routes, matchPath, useLocation, useNavigate } from "react-router";
import { api, type AuthIdentity, type Project } from "@/api";
import { AppBreadcrumbs, type Crumb } from "@/components/AppBreadcrumbs";
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

function NotFound({ message }: { message: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <p className="text-sm text-muted-foreground">{message}</p>
      <Button asChild variant="outline" size="sm">
        <Link to="/">Back to projects</Link>
      </Button>
    </div>
  );
}

export default function App({
  identity,
  onLogout,
}: {
  identity: AuthIdentity;
  onLogout: () => void;
}) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // The URL is the single source of truth for what's on screen — a refresh or
  // a pasted link lands on the same page.
  const selected = matchPath("/projects/:slug", pathname)?.params.slug ?? null;
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
      .catch(() => setProjects([]))
      .finally(() => setProjectsLoaded(true));
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
    navigate(`/projects/${encodeURIComponent(slug)}`);
  }

  function handleCreated(slug: string) {
    refreshProjects();
    selectProject(slug);
  }

  function handleProjectUpdated(updated: Project) {
    setProjects((prev) =>
      prev.map((p) => (p.slug === updated.slug ? updated : p)),
    );
  }

  const isAdmin = identity.scope === "admin";
  const crumbs = useMemo<Crumb[]>(() => {
    const home: Crumb = { label: "Home", to: "/" };
    const page = (label: string): Crumb[] => [home, { label }];
    if (pathname === "/") return [{ label: "Home" }];
    if (pathname === "/new") return page("New project");
    if (pathname === "/guide") return page("Guide");
    if (pathname === "/assistant") return page("Assistant");
    if (pathname === "/plans") return page("Plans");
    if (pathname === "/tokens") return page("Tokens");
    if (selected) return [home, { label: selectedProject?.title ?? selected }];
    return page("Not found");
  }, [pathname, selected, selectedProject]);

  // Header icon buttons are real links that toggle: clicking the one for the
  // page you're on goes back home.
  const navTarget = (to: string) => (pathname === to ? "/" : to);

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border/60 px-4">
        <Button
          asChild
          className="glow-ring flex size-7 shrink-0 items-center justify-center rounded-lg"
          style={
            {
              "--glow-color": "var(--accent-blue)",
              backgroundColor: "var(--primary)",
            } as React.CSSProperties
          }
        >
          <Link to="/" aria-label="Home">
            <Brain className="size-4 text-primary-foreground" />
          </Link>
        </Button>
        <ProjectSwitcher
          projects={projects}
          selected={selected}
          onSelect={selectProject}
          onCreate={() => navigate("/new")}
          open={switcherOpen}
          onOpenChange={setSwitcherOpen}
        />
        <AppBreadcrumbs crumbs={crumbs} className="min-w-0 flex-1" />
        <Button
          asChild
          variant={pathname === "/guide" ? "secondary" : "ghost"}
          size="icon"
          title="Guide"
        >
          <Link to={navTarget("/guide")} aria-label="Guide">
            <BookOpen className="size-4" />
          </Link>
        </Button>
        {identity.scope !== "read_only" && (
          <Button
            asChild
            variant={pathname === "/assistant" ? "secondary" : "ghost"}
            size="icon"
            title="Assistant"
          >
            <Link to={navTarget("/assistant")} aria-label="Assistant">
              <Sparkles className="size-4" />
            </Link>
          </Button>
        )}
        {identity.scope === "admin" && (
          <Button
            asChild
            variant={pathname === "/plans" ? "secondary" : "ghost"}
            size="icon"
            title="Plans awaiting approval"
            className="relative"
            onClick={refreshPendingPlans}
          >
            <Link to={navTarget("/plans")} aria-label="Plans">
              <ClipboardCheck className="size-4" />
              {pendingPlans > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
                  {pendingPlans}
                </span>
              )}
            </Link>
          </Button>
        )}
        {identity.scope === "admin" && (
          <Button
            asChild
            variant={pathname === "/tokens" ? "secondary" : "ghost"}
            size="icon"
            title="Tokens"
          >
            <Link to={navTarget("/tokens")} aria-label="Tokens">
              <KeyRound className="size-4" />
            </Link>
          </Button>
        )}
        <Button variant="ghost" size="icon" title="Log out" aria-label="Log out" onClick={onLogout}>
          <LogOut className="size-4" />
        </Button>
        <ModeToggle />
      </header>
      <main className="min-h-0 flex-1 overflow-hidden p-4">
        <Routes>
          <Route
            index
            element={
              <ProjectsOverview
                isAdmin={isAdmin}
                projects={projects}
                onSelect={selectProject}
                onCreate={() => navigate("/new")}
              />
            }
          />
          <Route
            path="new"
            element={
              <CreateProjectPage onCreated={handleCreated} onCancel={() => navigate("/")} />
            }
          />
          <Route
            path="projects/:slug"
            element={
              selectedProject ? (
                <ProjectView
                  isAdmin={isAdmin}
                  project={selectedProject}
                  onProjectUpdated={handleProjectUpdated}
                />
              ) : projectsLoaded ? (
                <NotFound message="This project doesn't exist, or your token can't access it." />
              ) : null
            }
          />
          <Route path="guide" element={<GuidePage />} />
          {identity.scope !== "read_only" && (
            <Route
              path="assistant"
              element={
                <AssistantPage
                  onOpenProject={selectProject}
                  onPlansChanged={() => {
                    refreshPendingPlans();
                    refreshProjects();
                  }}
                />
              }
            />
          )}
          {isAdmin && (
            <Route
              path="plans"
              element={
                <PlansPage
                  onChanged={() => {
                    refreshPendingPlans();
                    refreshProjects();
                  }}
                />
              }
            />
          )}
          {isAdmin && <Route path="tokens" element={<TokensPage />} />}
          <Route path="projects" element={<Navigate to="/" replace />} />
          <Route path="*" element={<NotFound message="There's nothing at this address." />} />
        </Routes>
      </main>
      <ShortcutsHelp open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </div>
  );
}

import { useEffect, useState } from "react";
import { api, type Project } from "@/api";
import { ProjectIcon } from "@/components/ProjectIcon";
import { Button } from "@/components/ui/button";
import { FolderPlus, Plus } from "lucide-react";

function ProjectCard({ project, onSelect }: { project: Project; onSelect: () => void }) {
  const [docCount, setDocCount] = useState<number | null>(null);

  // Doc count has no home in the projects list response — it's an R2 prefix
  // listing (see DocsService.list), so each card fetches its own. Fine at
  // the scale this app runs at (single user, a handful of projects).
  useEffect(() => {
    let cancelled = false;
    api
      .getDocs(project.slug)
      .then((r) => {
        if (!cancelled) setDocCount(r.filenames.length);
      })
      .catch(() => {
        if (!cancelled) setDocCount(0);
      });
    return () => {
      cancelled = true;
    };
  }, [project.slug]);

  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex flex-col gap-3 rounded-2xl border border-border bg-card/40 p-4 text-left transition-colors hover:border-primary/40 hover:bg-card/70"
    >
      <div className="flex items-center gap-3">
        <ProjectIcon slug={project.slug} title={project.title} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold leading-tight">{project.title}</p>
          <p className="truncate text-xs text-muted-foreground">{project.slug}</p>
        </div>
      </div>
      <p className="line-clamp-2 min-h-[2.5em] text-sm text-muted-foreground">
        {project.summary?.trim() || "No summary yet"}
      </p>
      <div className="mt-auto flex items-center gap-2 pt-1 text-xs text-muted-foreground">
        <span className="rounded-full bg-muted px-2 py-0.5 font-medium tabular-nums">
          {project.entityCount} {project.entityCount === 1 ? "entity" : "entities"}
        </span>
        <span className="rounded-full bg-muted px-2 py-0.5 font-medium tabular-nums">
          {docCount === null ? "…" : docCount} {docCount === 1 ? "doc" : "docs"}
        </span>
      </div>
    </button>
  );
}

export function ProjectsOverview({
  projects,
  onSelect,
  onCreate,
}: {
  projects: Project[];
  onSelect: (slug: string) => void;
  onCreate: () => void;
}) {
  if (projects.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
        <span
          className="glow-ring flex size-14 shrink-0 items-center justify-center rounded-2xl bg-primary/15"
          style={{ "--glow-color": "var(--accent-blue)" } as React.CSSProperties}
        >
          <FolderPlus className="size-6 text-primary" />
        </span>
        <div>
          <h2 className="text-lg font-semibold leading-tight">No projects yet</h2>
          <p className="text-sm text-muted-foreground">
            Create your first project to start building memory.
          </p>
        </div>
        <Button onClick={onCreate} className="gap-2">
          <Plus className="size-4" />
          Create your first project
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto pb-4">
      <div>
        <h2 className="text-lg font-semibold leading-tight">Projects</h2>
        <p className="text-sm text-muted-foreground">Select a project to open it.</p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {projects.map((project) => (
          <ProjectCard
            key={project.slug}
            project={project}
            onSelect={() => onSelect(project.slug)}
          />
        ))}
      </div>
      <Button variant="outline" onClick={onCreate} className="w-fit gap-2 self-center">
        <Plus className="size-4" />
        Create new project
      </Button>
    </div>
  );
}

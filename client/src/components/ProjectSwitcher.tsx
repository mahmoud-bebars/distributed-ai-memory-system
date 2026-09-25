import type { Project } from "@/api";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus } from "lucide-react";

// Sentinel value for the trailing "New project" entry — distinct from any
// real slug, which is constrained to lowercase alphanumerics and hyphens.
const CREATE_VALUE = "__create__";

export function ProjectSwitcher({
  projects,
  selected,
  onSelect,
  onCreate,
  open,
  onOpenChange,
}: {
  projects: Project[];
  selected: string | null;
  onSelect: (slug: string) => void;
  onCreate: () => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <Select
      value={selected ?? undefined}
      onValueChange={(v) => (v === CREATE_VALUE ? onCreate() : onSelect(v))}
      open={open}
      onOpenChange={onOpenChange}
    >
      <SelectTrigger className="w-48 sm:w-64" id="project-switcher">
        <SelectValue placeholder="Select a project…" />
      </SelectTrigger>
      <SelectContent>
        {projects.length === 0 ? (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">No projects yet</p>
        ) : (
          projects.map((project) => (
            <SelectItem key={project.slug} value={project.slug}>
              {project.title}
            </SelectItem>
          ))
        )}
        {projects.length > 0 && <SelectSeparator />}
        <SelectItem value={CREATE_VALUE} className="text-primary">
          <Plus className="size-3.5" />
          New project
        </SelectItem>
      </SelectContent>
    </Select>
  );
}

import type { Project } from "../api";

export function ProjectList({
  projects,
  onSelect,
}: {
  projects: Project[];
  onSelect: (slug: string) => void;
}) {
  if (projects.length === 0) {
    return <p className="text-sm text-gray-500">No projects yet — create one via the API.</p>;
  }

  return (
    <ul className="space-y-2">
      {projects.map((project) => (
        <li key={project.slug}>
          <button
            onClick={() => onSelect(project.slug)}
            className="w-full text-left border rounded px-4 py-3 hover:bg-gray-50"
          >
            <div className="font-medium">{project.title}</div>
            <div className="text-xs text-gray-500">
              {project.entityCount} entries · updated {project.updatedAt}
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

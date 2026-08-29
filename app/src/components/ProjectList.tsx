import { useState, type FormEvent } from "react";
import { api, type Project } from "../api";

// Lowercase, collapse any run of non-alphanumerics to a single hyphen, trim
// leading/trailing hyphens — matches the server's slug rules
// (^[a-z0-9][a-z0-9-]*$).
function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function ProjectList({
  projects,
  onSelect,
  onCreated,
}: {
  projects: Project[];
  onSelect: (slug: string) => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    const trimmed = title.trim();
    const slug = slugify(trimmed);
    if (!slug) {
      setError("Enter a title with at least one letter or number.");
      return;
    }

    setCreating(true);
    setError(null);
    try {
      await api.createProject({ slug, title: trimmed, tags: [] });
      setTitle("");
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create project.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={handleCreate} className="space-y-2">
        <div className="flex gap-2">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="New project title"
            className="flex-1 border rounded px-4 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={creating}
            className="border rounded px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
          >
            {creating ? "Creating…" : "Create"}
          </button>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>

      {projects.length === 0 ? (
        <p className="text-sm text-gray-500">No projects yet — create one above.</p>
      ) : (
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
      )}
    </div>
  );
}

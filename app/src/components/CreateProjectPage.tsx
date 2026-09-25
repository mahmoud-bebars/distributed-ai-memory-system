import { useState, type FormEvent } from "react";
import { api } from "@/api";
import { TagEditor } from "@/components/TagEditor";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Info } from "lucide-react";

// Lowercase, collapse any run of non-alphanumerics to a single hyphen, trim
// leading/trailing hyphens — matches the server's slug rules
// (^[a-z0-9][a-z0-9-]*$). Used both to derive the slug from the title live,
// and to sanitize whatever the user types directly into the slug field.
function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function CreateProjectPage({
  onCreated,
  onCancel,
}: {
  onCreated: (slug: string) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  // Once the user edits the slug directly, stop overwriting it from the
  // title — otherwise every keystroke in Title would clobber their choice.
  const [slugTouched, setSlugTouched] = useState(false);
  const [summary, setSummary] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleTitleChange(value: string) {
    setTitle(value);
    if (!slugTouched) setSlug(slugify(value));
  }

  function handleSlugChange(value: string) {
    setSlugTouched(true);
    setSlug(slugify(value));
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError("Enter a title.");
      return;
    }
    if (!slug) {
      setError("Enter a slug with at least one letter or number.");
      return;
    }

    setCreating(true);
    setError(null);
    try {
      const project = await api.createProject({
        slug,
        title: trimmedTitle,
        summary: summary.trim() || undefined,
        tags,
      });
      onCreated(project.slug);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create project.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="mx-auto flex h-full max-w-lg flex-col justify-center gap-4">
      <div>
        <h2 className="text-lg font-semibold leading-tight">New project</h2>
        <p className="text-sm text-muted-foreground">Creates an empty memory store.</p>
      </div>
      <Card>
        <CardContent>
          <form onSubmit={handleCreate} className="flex flex-col gap-4">
            <div className="space-y-2">
              <Label htmlFor="project-title">Title</Label>
              <Input
                id="project-title"
                autoFocus
                value={title}
                onChange={(e) => handleTitleChange(e.target.value)}
                placeholder="Project title"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="project-slug">Slug</Label>
              <Input
                id="project-slug"
                value={slug}
                onChange={(e) => handleSlugChange(e.target.value)}
                placeholder="derived-from-title"
                className="font-mono text-sm"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="project-summary">
                Summary <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Textarea
                id="project-summary"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                placeholder="What is this project about?"
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="project-tags">
                Tags <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <TagEditor id="project-tags" tags={tags} onChange={setTags} />
            </div>
            <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-2.5 text-xs text-muted-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              <p>
                The slug can't be changed after creation — it's how AI agents address this
                project over MCP. The title, summary, and tags can all be edited anytime.
              </p>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="ghost" onClick={onCancel} disabled={creating}>
                Cancel
              </Button>
              <Button type="submit" disabled={creating}>
                {creating ? "Creating…" : "Create project"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

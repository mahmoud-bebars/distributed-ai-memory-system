import { useState, type FormEvent } from "react";
import { api } from "@/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus } from "lucide-react";

// Lowercase, collapse any run of non-alphanumerics to a single hyphen, trim
// leading/trailing hyphens — matches the server's slug rules
// (^[a-z0-9][a-z0-9-]*$).
function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function CreateProjectDialog({ onCreated }: { onCreated: (slug: string) => void }) {
  const [open, setOpen] = useState(false);
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
      setOpen(false);
      onCreated(slug);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create project.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="w-full justify-start gap-2">
          <Plus className="size-4" />
          New project
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleCreate}>
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
            <DialogDescription>
              Creates an empty memory store. The slug is derived from the title.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-4">
            <Label htmlFor="project-title">Title</Label>
            <Input
              id="project-title"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Project title"
            />
            {title.trim() && (
              <p className="text-xs text-muted-foreground">slug: {slugify(title.trim()) || "—"}</p>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={creating}>
              {creating ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

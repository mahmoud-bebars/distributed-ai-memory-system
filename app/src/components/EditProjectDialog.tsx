import { useEffect, useState } from "react";
import { api, type Project } from "@/api";
import { TagEditor } from "@/components/TagEditor";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { parseTags } from "@/lib/tags";

// Title, summary, and tags are editable after creation — the slug is
// permanent (see CreateProjectPage): it's the D1 primary key, the R2 key
// prefix, and how every MCP tool addresses this project, so it's shown here
// read-only rather than as an input.
//
// Open state is controlled by the caller (ProjectView's consolidated actions
// menu) rather than owning its own trigger — this dialog is one of several
// items in that dropdown, not a standalone button.
export function EditProjectDialog({
  project,
  open,
  onOpenChange,
  onUpdated,
}: {
  project: Project;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated: (project: Project) => void;
}) {
  const [title, setTitle] = useState(project.title);
  const [summary, setSummary] = useState(project.summary ?? "");
  const [tags, setTags] = useState<string[]>(() => parseTags(project.tags));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTitle(project.title);
      setSummary(project.summary ?? "");
      setTags(parseTags(project.tags));
      setError(null);
    }
  }, [open, project]);

  async function handleSave() {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError("Title can't be empty.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const updated = await api.updateProject(project.slug, {
        title: trimmedTitle,
        summary: summary.trim(),
        tags,
      });
      onUpdated(updated);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update project.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit project</DialogTitle>
          <DialogDescription>
            The slug ({project.slug}) can't be changed — it's how AI agents address this project
            over MCP.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="edit-project-title">Title</Label>
            <Input
              id="edit-project-title"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Project title"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-project-summary">Summary</Label>
            <Textarea
              id="edit-project-summary"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="What is this project about?"
              rows={4}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-project-tags">Tags</Label>
            <TagEditor id="edit-project-tags" tags={tags} onChange={setTags} />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

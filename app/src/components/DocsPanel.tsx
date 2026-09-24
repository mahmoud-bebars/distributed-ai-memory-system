import { useCallback, useEffect, useState } from "react";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Plus } from "lucide-react";

// Markdown doc files stored separately from memory.jsonl (see
// src/modules/docs). This panel is the first frontend surface for them —
// the backend/MCP tools (append_doc, update_doc, delete_doc) predate it.
export function DocsPanel({ slug }: { slug: string }) {
  const [filenames, setFilenames] = useState<string[]>([]);
  const [listError, setListError] = useState<string | null>(null);

  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [contentLoading, setContentLoading] = useState(false);
  const [contentError, setContentError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [appendText, setAppendText] = useState("");
  const [appending, setAppending] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [createFilename, setCreateFilename] = useState("");
  const [createContent, setCreateContent] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const refreshList = useCallback(() => {
    return api
      .getDocs(slug)
      .then((r) => setFilenames(r.filenames))
      .catch((err) => setListError(err instanceof Error ? err.message : "Failed to load docs."));
  }, [slug]);

  useEffect(() => {
    setSelected(null);
    refreshList();
  }, [refreshList]);

  function selectFile(filename: string) {
    setSelected(filename);
    setContentLoading(true);
    setContentError(null);
    api
      .getDoc(slug, filename)
      .then((text) => {
        setContent(text);
        setOriginalContent(text);
      })
      .catch((err) => setContentError(err instanceof Error ? err.message : "Failed to load doc."))
      .finally(() => setContentLoading(false));
  }

  async function handleSave() {
    if (!selected) return;
    setSaving(true);
    setContentError(null);
    try {
      await api.updateDoc(slug, selected, content);
      setOriginalContent(content);
    } catch (err) {
      setContentError(err instanceof Error ? err.message : "Failed to save doc.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!selected) return;
    if (!window.confirm(`Delete "${selected}"? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await api.deleteDoc(slug, selected);
      setSelected(null);
      setContent("");
      setOriginalContent("");
      await refreshList();
    } catch (err) {
      setContentError(err instanceof Error ? err.message : "Failed to delete doc.");
    } finally {
      setDeleting(false);
    }
  }

  async function handleAppend() {
    if (!selected || !appendText.trim()) return;
    setAppending(true);
    setContentError(null);
    try {
      await api.appendDoc(slug, selected, appendText.trim());
      setAppendText("");
      const text = await api.getDoc(slug, selected);
      setContent(text);
      setOriginalContent(text);
    } catch (err) {
      setContentError(err instanceof Error ? err.message : "Failed to append.");
    } finally {
      setAppending(false);
    }
  }

  async function handleCreate() {
    setCreating(true);
    setCreateError(null);
    try {
      await api.appendDoc(slug, createFilename.trim(), createContent);
      setCreateOpen(false);
      const filename = createFilename.trim();
      setCreateFilename("");
      setCreateContent("");
      await refreshList();
      selectFile(filename);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create doc.");
    } finally {
      setCreating(false);
    }
  }

  const dirty = content !== originalContent;

  return (
    <div className="flex h-full min-h-0 gap-4">
      <div className="flex w-56 shrink-0 flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Docs</span>
          <Dialog
            open={createOpen}
            onOpenChange={(next) => {
              setCreateOpen(next);
              setCreateError(null);
            }}
          >
            <DialogTrigger asChild>
              <Button size="icon-sm" variant="outline" title="New doc">
                <Plus className="size-4" />
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>New doc</DialogTitle>
                <DialogDescription>
                  Filename must end in .md — letters, numbers, dots, hyphens, and underscores only.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 py-2">
                <Input
                  placeholder="notes.md"
                  value={createFilename}
                  onChange={(e) => setCreateFilename(e.target.value)}
                  className="font-mono text-sm"
                />
                <Textarea
                  placeholder="Initial content…"
                  value={createContent}
                  onChange={(e) => setCreateContent(e.target.value)}
                  className="min-h-32"
                />
                {createError && <p className="text-xs text-destructive">{createError}</p>}
              </div>
              <DialogFooter>
                <Button
                  onClick={handleCreate}
                  disabled={!createFilename.trim() || !createContent.trim() || creating}
                >
                  {creating ? "Creating…" : "Create"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
        <ScrollArea className="min-h-0 flex-1 rounded-md border">
          <div className="flex flex-col gap-0.5 p-1">
            {filenames.length === 0 && (
              <p className="p-2 text-xs text-muted-foreground">No docs yet.</p>
            )}
            {filenames.map((filename) => (
              <button
                key={filename}
                type="button"
                onClick={() => selectFile(filename)}
                className={cn(
                  "rounded px-2 py-1.5 text-left font-mono text-xs hover:bg-muted",
                  selected === filename && "bg-muted font-medium",
                )}
              >
                {filename}
              </button>
            ))}
          </div>
        </ScrollArea>
        {listError && <p className="text-xs text-destructive">{listError}</p>}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2">
        {!selected && (
          <p className="text-sm text-muted-foreground">Select a doc to view or edit it.</p>
        )}
        {selected && (
          <>
            <div className="flex items-center justify-between">
              <span className="font-mono text-sm">{selected}</span>
              <div className="flex gap-2">
                <Button size="sm" onClick={handleSave} disabled={!dirty || saving}>
                  {saving ? "Saving…" : "Save"}
                </Button>
                <Button size="sm" variant="destructive" onClick={handleDelete} disabled={deleting}>
                  {deleting ? "Deleting…" : "Delete"}
                </Button>
              </div>
            </div>

            {contentLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (
              <Textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="min-h-0 flex-1 resize-none font-mono text-xs"
              />
            )}
            {contentError && <p className="text-xs text-destructive">{contentError}</p>}

            <div className="flex shrink-0 gap-2 border-t pt-2">
              <Textarea
                placeholder="Append a note — adds a new dated section instead of overwriting…"
                value={appendText}
                onChange={(e) => setAppendText(e.target.value)}
                className="min-h-16 flex-1 text-xs"
              />
              <Button
                size="sm"
                className="self-end"
                onClick={handleAppend}
                disabled={!appendText.trim() || appending}
              >
                {appending ? "Appending…" : "Append"}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

import { useCallback, useEffect, useState } from "react";
import { api } from "@/api";
import { MarkdownContent } from "@/components/MarkdownContent";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { ChevronsUpDown, Pencil, Plus } from "lucide-react";

type Mode = "preview" | "edit";

// Markdown doc files stored separately from memory.jsonl (see
// src/modules/docs). GitHub-style: a file opens in a rendered, read-only
// preview; an explicit Edit button switches to a raw textarea, with
// Save/Cancel to leave it. On narrow screens the file list moves into a
// bottom sheet instead of a permanent side column.
function DocFileList({
  filenames,
  selected,
  onSelect,
}: {
  filenames: string[];
  selected: string | null;
  onSelect: (filename: string) => void;
}) {
  if (filenames.length === 0) {
    return <p className="p-2 text-xs text-muted-foreground">No docs yet.</p>;
  }
  return (
    <div className="flex flex-col gap-0.5">
      {filenames.map((filename) => (
        <button
          key={filename}
          type="button"
          onClick={() => onSelect(filename)}
          className={cn(
            "rounded px-2 py-2 text-left font-mono text-xs hover:bg-muted",
            selected === filename && "bg-muted font-medium",
          )}
        >
          {filename}
        </button>
      ))}
    </div>
  );
}

export function DocsPanel({ slug }: { slug: string }) {
  const isMobile = useIsMobile();

  const [filenames, setFilenames] = useState<string[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [mobileListOpen, setMobileListOpen] = useState(false);

  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("preview");
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

  const dirty = content !== originalContent;

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

  function loadFile(filename: string) {
    setSelected(filename);
    setMode("preview");
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

  function handleSelect(filename: string) {
    if (mode === "edit" && dirty && !window.confirm("Discard unsaved changes?")) return;
    loadFile(filename);
    setMobileListOpen(false);
  }

  function handleCancelEdit() {
    setContent(originalContent);
    setMode("preview");
  }

  async function handleSave() {
    if (!selected) return;
    setSaving(true);
    setContentError(null);
    try {
      await api.updateDoc(slug, selected, content);
      setOriginalContent(content);
      setMode("preview");
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
      const filename = createFilename.trim();
      await api.appendDoc(slug, filename, createContent);
      setCreateOpen(false);
      setCreateFilename("");
      setCreateContent("");
      await refreshList();
      loadFile(filename);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create doc.");
    } finally {
      setCreating(false);
    }
  }

  const newDocButton = (
    <Button size="icon-sm" variant="outline" title="New doc" onClick={() => setCreateOpen(true)}>
      <Plus className="size-4" />
    </Button>
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 md:flex-row md:gap-4">
      {isMobile ? (
        <div className="flex shrink-0 items-center gap-2">
          <Sheet open={mobileListOpen} onOpenChange={setMobileListOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" size="sm" className="flex-1 justify-between gap-2 font-mono">
                <span className="truncate">{selected ?? "Choose a doc…"}</span>
                <ChevronsUpDown className="size-4 shrink-0 opacity-60" />
              </Button>
            </SheetTrigger>
            <SheetContent side="bottom" className="max-h-[75vh] overflow-y-auto">
              <SheetHeader>
                <SheetTitle>Docs</SheetTitle>
              </SheetHeader>
              <div className="flex flex-col gap-2 px-4 pb-4">
                <DocFileList filenames={filenames} selected={selected} onSelect={handleSelect} />
              </div>
            </SheetContent>
          </Sheet>
          {newDocButton}
        </div>
      ) : (
        <div className="flex w-56 shrink-0 flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Docs</span>
            {newDocButton}
          </div>
          <ScrollArea className="min-h-0 flex-1 rounded-md border">
            <div className="p-1">
              <DocFileList filenames={filenames} selected={selected} onSelect={handleSelect} />
            </div>
          </ScrollArea>
        </div>
      )}
      {listError && <p className="text-xs text-destructive">{listError}</p>}

      <div className="flex min-h-0 flex-1 flex-col gap-2">
        {!selected && (
          <p className="text-sm text-muted-foreground">Select a doc to view or edit it.</p>
        )}
        {selected && (
          <>
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-mono text-sm">{selected}</span>
              <div className="flex shrink-0 gap-2">
                {mode === "preview" ? (
                  <>
                    <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setMode("edit")}>
                      <Pencil className="size-3.5" />
                      Edit
                    </Button>
                    <Button size="sm" variant="destructive" onClick={handleDelete} disabled={deleting}>
                      {deleting ? "Deleting…" : "Delete"}
                    </Button>
                  </>
                ) : (
                  <>
                    <Button size="sm" onClick={handleSave} disabled={!dirty || saving}>
                      {saving ? "Saving…" : "Save"}
                    </Button>
                    <Button size="sm" variant="outline" onClick={handleCancelEdit}>
                      Cancel
                    </Button>
                  </>
                )}
              </div>
            </div>

            {contentLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : mode === "preview" ? (
              <ScrollArea className="min-h-0 flex-1 rounded-md border p-4">
                {content.trim().length > 0 ? (
                  <MarkdownContent content={content} />
                ) : (
                  <p className="text-sm text-muted-foreground">This doc is empty.</p>
                )}
              </ScrollArea>
            ) : (
              <Textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="min-h-0 flex-1 resize-none font-mono text-xs"
              />
            )}
            {contentError && <p className="text-xs text-destructive">{contentError}</p>}

            {mode === "preview" && (
              <div className="flex shrink-0 flex-col gap-2 border-t pt-2 sm:flex-row">
                <Textarea
                  placeholder="Append a note — adds a new dated section instead of overwriting…"
                  value={appendText}
                  onChange={(e) => setAppendText(e.target.value)}
                  className="min-h-16 flex-1 text-xs"
                />
                <Button
                  size="sm"
                  className="sm:self-end"
                  onClick={handleAppend}
                  disabled={!appendText.trim() || appending}
                >
                  {appending ? "Appending…" : "Append"}
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      <Dialog
        open={createOpen}
        onOpenChange={(next) => {
          setCreateOpen(next);
          setCreateError(null);
        }}
      >
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
  );
}

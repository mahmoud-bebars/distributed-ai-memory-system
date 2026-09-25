import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { FileText, Minimize2, Pencil, Plus, Upload } from "lucide-react";

const PDF2AI_URL = "https://pdf2ai.mahmoudbebars.dev";

type Mode = "preview" | "edit";

/** Where a DocsPanel reads (and, for "project", writes) its files. "share"
 *  is the public read-only /share/:token view — the backend only exposes
 *  GET on those routes (see src/modules/shares/routes.ts), so `readOnly`
 *  below is a UI convenience, not the actual enforcement boundary. */
export type DocsSource = { kind: "project"; slug: string } | { kind: "share"; token: string };

// Markdown doc files stored separately from memory.jsonl (see
// src/modules/docs). Browsing and reading are two distinct screens: a
// scrollable file list, and — once a file is picked — a fullscreen reader/
// editor overlay (matching ProjectView's graph fullscreen pattern) so a doc
// gets real reading room instead of being squeezed into the docked side panel.
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
            "glow-hover flex items-center gap-2 rounded-lg px-2 py-2 text-left",
            selected === filename && "bg-muted"
          )}
          style={{ "--glow-color": "var(--accent-teal)" } as React.CSSProperties}
        >
          <FileText className="size-3.5 shrink-0 text-muted-foreground" />
          <span className={cn("truncate font-mono text-xs", selected === filename && "font-medium")}>
            {filename}
          </span>
        </button>
      ))}
    </div>
  );
}

export function DocsPanel({ source }: { source: DocsSource }) {
  const readOnly = source.kind === "share";
  const sourceKey = source.kind === "project" ? source.slug : source.token;

  const [filenames, setFilenames] = useState<string[]>([]);
  const [listError, setListError] = useState<string | null>(null);

  const [selected, setSelected] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
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
  const fileInputRef = useRef<HTMLInputElement>(null);

  const dirty = !readOnly && content !== originalContent;

  const refreshList = useCallback(() => {
    const request = source.kind === "project" ? api.getDocs(source.slug) : api.getShareDocs(source.token);
    return request
      .then((r) => setFilenames(r.filenames))
      .catch((err) => setListError(err instanceof Error ? err.message : "Failed to load docs."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source.kind, sourceKey]);

  useEffect(() => {
    setSelected(null);
    setExpanded(false);
    refreshList();
  }, [refreshList]);

  function loadFile(filename: string) {
    setSelected(filename);
    setExpanded(true);
    setMode("preview");
    setContentLoading(true);
    setContentError(null);
    const request =
      source.kind === "project" ? api.getDoc(source.slug, filename) : api.getShareDoc(source.token, filename);
    request
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
  }

  function closeExpanded() {
    if (mode === "edit" && dirty && !window.confirm("Discard unsaved changes?")) return;
    setExpanded(false);
    setMode("preview");
  }

  useEffect(() => {
    if (!expanded) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") closeExpanded();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, mode, dirty]);

  function handleCancelEdit() {
    setContent(originalContent);
    setMode("preview");
  }

  async function handleSave() {
    if (!selected || source.kind !== "project") return;
    setSaving(true);
    setContentError(null);
    try {
      await api.updateDoc(source.slug, selected, content);
      setOriginalContent(content);
      setMode("preview");
    } catch (err) {
      setContentError(err instanceof Error ? err.message : "Failed to save doc.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!selected || source.kind !== "project") return;
    if (!window.confirm(`Delete "${selected}"? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await api.deleteDoc(source.slug, selected);
      setSelected(null);
      setExpanded(false);
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
    if (!selected || !appendText.trim() || source.kind !== "project") return;
    setAppending(true);
    setContentError(null);
    try {
      await api.appendDoc(source.slug, selected, appendText.trim());
      setAppendText("");
      const text = await api.getDoc(source.slug, selected);
      setContent(text);
      setOriginalContent(text);
    } catch (err) {
      setContentError(err instanceof Error ? err.message : "Failed to append.");
    } finally {
      setAppending(false);
    }
  }

  // Reads an uploaded file client-side and drops its text straight into the
  // create-doc form — nothing is sent to the server until Create is clicked.
  // Only .md is accepted: docFilenameSchema (src/modules/docs/schema.ts)
  // rejects anything else server-side anyway, so this is just a friendlier
  // failure than a 400 from the API, plus a pointer to pdf2ai for the PDF
  // case specifically, since that's the file type people most often reach
  // for here.
  function handleFileSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".md")) {
      setCreateError(
        file.name.toLowerCase().endsWith(".pdf")
          ? "PDFs aren't supported here — convert it to Markdown first (see the note below)."
          : "Only Markdown (.md) files can be uploaded here."
      );
      return;
    }

    setCreateError(null);
    const reader = new FileReader();
    reader.onload = () => {
      setCreateContent(typeof reader.result === "string" ? reader.result : "");
      setCreateFilename(file.name);
    };
    reader.onerror = () => setCreateError("Failed to read that file.");
    reader.readAsText(file);
  }

  async function handleCreate() {
    if (source.kind !== "project") return;
    setCreating(true);
    setCreateError(null);
    try {
      const filename = createFilename.trim();
      await api.appendDoc(source.slug, filename, createContent);
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

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Docs</span>
        {!readOnly && (
          <Button size="icon-sm" variant="outline" title="New doc" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
          </Button>
        )}
      </div>
      {listError && <p className="text-xs text-destructive">{listError}</p>}
      <ScrollArea className="min-h-0 flex-1 rounded-xl border border-border">
        <div className="p-1.5">
          <DocFileList filenames={filenames} selected={selected} onSelect={handleSelect} />
        </div>
      </ScrollArea>

      {expanded && selected && (
        <div className="fixed inset-4 z-50 flex flex-col gap-3 rounded-2xl bg-background p-3 shadow-2xl ring-1 ring-border">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <Button variant="ghost" size="icon-sm" title="Back to docs" onClick={closeExpanded}>
                <Minimize2 className="size-4" />
              </Button>
              <FileText className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate font-mono text-sm">{selected}</span>
              {readOnly && (
                <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                  Read-only
                </span>
              )}
            </div>
            {!readOnly && (
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
            )}
          </div>

          {contentLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : mode === "preview" ? (
            <ScrollArea className="min-h-0 flex-1 rounded-xl border border-border p-4">
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

          {!readOnly && mode === "preview" && (
            <div className="flex shrink-0 flex-col gap-2 border-t border-border pt-2 sm:flex-row">
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
        </div>
      )}

      {!readOnly && (
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
              <input
                ref={fileInputRef}
                type="file"
                accept=".md,text/markdown"
                onChange={handleFileSelected}
                className="hidden"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="size-3.5" />
                Upload a .md file
              </Button>
              <p className="text-xs text-muted-foreground">
                Only Markdown (.md) files can be uploaded. Have a PDF? Convert it to Markdown
                first at{" "}
                <a
                  href={PDF2AI_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline underline-offset-2"
                >
                  pdf2ai.mahmoudbebars.dev
                </a>
                , then upload the result here.
              </p>
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
      )}
    </div>
  );
}

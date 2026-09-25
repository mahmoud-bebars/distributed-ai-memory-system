import { useEffect, useState } from "react";
import { api, type ExpirationOption, type ShareLink, type ShareLinkInput } from "@/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/CopyButton";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { MessageCircle, Pencil, Plus, ScrollText, Trash2 } from "lucide-react";

const EXPIRATION_LABELS: Record<ExpirationOption, string> = {
  "1d": "1 day",
  "7d": "7 days",
  "30d": "30 days",
  "90d": "90 days",
  never: "Never",
};

function expiryStatus(expiresAt: string | null): { text: string; expired: boolean } {
  if (!expiresAt) return { text: "Never expires", expired: false };
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return { text: "Expired", expired: true };
  const days = Math.ceil(ms / (24 * 60 * 60 * 1000));
  return { text: days === 1 ? "Expires in 1 day" : `Expires in ${days} days`, expired: false };
}

type FormState = {
  label: string;
  allowChat: boolean;
  allowDocs: boolean;
  expiresIn: ExpirationOption;
};

const EMPTY_FORM: FormState = { label: "", allowChat: false, allowDocs: false, expiresIn: "never" };

function LinkForm({
  form,
  onChange,
  keepExpiryNote,
}: {
  form: FormState;
  onChange: (form: FormState) => void;
  keepExpiryNote?: string;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="share-link-label">Description</Label>
        <Input
          id="share-link-label"
          placeholder="e.g. For the design team"
          value={form.label}
          onChange={(e) => onChange({ ...form, label: e.target.value })}
        />
      </div>
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
        <div className="space-y-0.5">
          <p className="text-sm font-medium">Allow chat</p>
          <p className="text-xs text-muted-foreground">
            Visitors can ask this project's memory questions, using your Anthropic API key.
          </p>
        </div>
        <Switch
          checked={form.allowChat}
          onCheckedChange={(checked) => onChange({ ...form, allowChat: checked })}
        />
      </div>
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
        <div className="space-y-0.5">
          <p className="text-sm font-medium">Allow docs</p>
          <p className="text-xs text-muted-foreground">
            Include project docs — off shares only the memory graph and entries.
          </p>
        </div>
        <Switch
          checked={form.allowDocs}
          onCheckedChange={(checked) => onChange({ ...form, allowDocs: checked })}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="share-link-expiry">Expires</Label>
        <Select
          value={form.expiresIn}
          onValueChange={(v) => onChange({ ...form, expiresIn: v as ExpirationOption })}
        >
          <SelectTrigger id="share-link-expiry" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(EXPIRATION_LABELS) as ExpirationOption[]).map((option) => (
              <SelectItem key={option} value={option}>
                {EXPIRATION_LABELS[option]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {keepExpiryNote && <p className="text-xs text-muted-foreground">{keepExpiryNote}</p>}
      </div>
    </div>
  );
}

function LinkRow({
  link,
  onEdit,
  onRevoke,
  busy,
}: {
  link: ShareLink;
  onEdit: () => void;
  onRevoke: () => void;
  busy: boolean;
}) {
  const expiry = expiryStatus(link.expiresAt);
  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{link.label || "Untitled link"}</p>
          <p className={`text-xs ${expiry.expired ? "text-destructive" : "text-muted-foreground"}`}>
            {expiry.text}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="icon-sm" title="Edit link" onClick={onEdit}>
            <Pencil className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            title="Revoke link"
            onClick={onRevoke}
            disabled={busy}
          >
            <Trash2 className="size-3.5 text-destructive" />
          </Button>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Input readOnly value={link.url} className="font-mono text-xs" />
        <CopyButton text={link.url} size="sm" />
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Badge variant="outline">Graph + Entries</Badge>
        {link.allowDocs && (
          <Badge variant="outline" className="gap-1">
            <ScrollText className="size-3" />
            Docs
          </Badge>
        )}
        {link.allowChat && (
          <Badge variant="outline" className="gap-1">
            <MessageCircle className="size-3" />
            Chat
          </Badge>
        )}
      </div>
    </div>
  );
}

// Open state is controlled by the caller (ProjectView's consolidated
// actions menu) rather than owning its own trigger.
export function ShareDialog({
  slug,
  open,
  onOpenChange,
}: {
  slug: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [links, setLinks] = useState<ShareLink[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // "list" | "create" | an editing link's token
  const [view, setView] = useState<"list" | "create" | string>("list");
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  function refreshList() {
    api
      .listShareLinks(slug)
      .then(setLinks)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load share links."));
  }

  useEffect(() => {
    if (open) {
      setView("list");
      setError(null);
      refreshList();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, slug]);

  function startCreate() {
    setForm(EMPTY_FORM);
    setError(null);
    setView("create");
  }

  function startEdit(link: ShareLink) {
    setForm({
      label: link.label ?? "",
      allowChat: link.allowChat,
      allowDocs: link.allowDocs,
      expiresIn: "never", // sentinel meaning "unchanged" until the user touches it
    });
    setError(null);
    setView(link.token);
  }

  const editingToken = view !== "list" && view !== "create" ? view : null;
  const editingLink = editingToken ? links?.find((l) => l.token === editingToken) : null;

  async function handleSaveCreate() {
    setBusy(true);
    setError(null);
    try {
      const input: ShareLinkInput = {
        label: form.label.trim() || undefined,
        allowChat: form.allowChat,
        allowDocs: form.allowDocs,
        expiresIn: form.expiresIn,
      };
      await api.createShareLink(slug, input);
      setView("list");
      refreshList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create share link.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveEdit() {
    if (!editingToken || !editingLink) return;
    setBusy(true);
    setError(null);
    try {
      // The expiry Select was reset to "never" as a neutral starting point
      // in startEdit — only send it through (letting the server recompute
      // an absolute expiresAt) if the user actually touched it away from
      // the link's real current state, otherwise leave expiry untouched.
      const expiryUnchanged =
        form.expiresIn === "never" && editingLink.expiresAt === null;
      await api.updateShareLink(slug, editingToken, {
        label: form.label.trim() || undefined,
        allowChat: form.allowChat,
        allowDocs: form.allowDocs,
        expiresIn: expiryUnchanged ? undefined : form.expiresIn,
      });
      setView("list");
      refreshList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update share link.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRevoke(token: string) {
    if (!window.confirm("Revoke this share link? Anyone using it will lose access immediately.")) return;
    setBusy(true);
    setError(null);
    try {
      await api.revokeShareLink(slug, token);
      refreshList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke share link.");
    } finally {
      setBusy(false);
    }
  }

  const isFormView = view !== "list";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isFormView ? (editingToken ? "Edit share link" : "New share link") : "Share this project"}</DialogTitle>
          <DialogDescription>
            {isFormView
              ? "Every visitor with this link sees the memory graph and entries, read-only. Chat and docs are opt-in below."
              : "Create as many links as you need — each has its own description, permissions, and expiration."}
          </DialogDescription>
        </DialogHeader>

        {!isFormView && (
          <div className="space-y-3">
            {links === null && <p className="text-sm text-muted-foreground">Loading…</p>}
            {links !== null && links.length === 0 && (
              <p className="text-sm text-muted-foreground">No share links yet.</p>
            )}
            {links !== null && links.length > 0 && (
              <div className="max-h-80 space-y-2 overflow-y-auto">
                {links.map((link) => (
                  <LinkRow
                    key={link.token}
                    link={link}
                    busy={busy}
                    onEdit={() => startEdit(link)}
                    onRevoke={() => handleRevoke(link.token)}
                  />
                ))}
              </div>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button variant="outline" size="sm" className="gap-1.5" onClick={startCreate}>
              <Plus className="size-3.5" />
              New share link
            </Button>
          </div>
        )}

        {isFormView && (
          <div className="space-y-4">
            <LinkForm
              form={form}
              onChange={setForm}
              keepExpiryNote={editingToken ? "Leave as-is to keep this link's current expiration." : undefined}
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        )}

        <DialogFooter>
          {isFormView && (
            <>
              <Button variant="outline" onClick={() => setView("list")} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={editingToken ? handleSaveEdit : handleSaveCreate} disabled={busy}>
                {busy ? "Saving…" : "Save"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useState } from "react";
import { api, type ShareStatus } from "@/api";
import { CopyButton } from "@/components/CopyButton";
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
import { Share2 } from "lucide-react";

export function ShareDialog({ slug }: { slug: string }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<ShareStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function refreshStatus() {
    api
      .getShareStatus(slug)
      .then(setStatus)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load share status."));
  }

  async function handleGenerate() {
    setBusy(true);
    setError(null);
    try {
      const result = await api.createShare(slug);
      setStatus({ active: true, ...result });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create share link.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRevoke() {
    setBusy(true);
    setError(null);
    try {
      await api.revokeShare(slug);
      setStatus({ active: false });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke share link.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setError(null);
        if (next) refreshStatus();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Share2 className="size-4" />
          Share
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share this project</DialogTitle>
          <DialogDescription>
            Anyone with the link can view this project's Graph and Entries tabs, read-only — no
            login, no other projects visible, nothing editable.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {status === null && <p className="text-sm text-muted-foreground">Loading…</p>}

          {status?.active === false && (
            <Button onClick={handleGenerate} disabled={busy} size="sm">
              {busy ? "Generating…" : "Generate share link"}
            </Button>
          )}

          {status?.active === true && (
            <div className="space-y-2">
              <div className="flex gap-2">
                <Input readOnly value={status.url} className="font-mono text-xs" />
                <CopyButton text={status.url} size="sm" />
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={handleGenerate} disabled={busy}>
                  {busy ? "Working…" : "Regenerate"}
                </Button>
                <Button variant="destructive" size="sm" onClick={handleRevoke} disabled={busy}>
                  {busy ? "Working…" : "Revoke"}
                </Button>
              </div>
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  );
}

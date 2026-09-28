import { useEffect, useState } from "react";
import { api, type ApiToken, type CreateTokenInput, type ExpirationOption, type TokenScope } from "@/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CopyButton } from "@/components/CopyButton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";

const SCOPE_LABELS: Record<TokenScope, string> = {
  admin: "Admin",
  read_write: "Read/write",
  read_only: "Read-only",
};

const EXPIRATION_LABELS: Record<ExpirationOption, string> = {
  "1d": "1 day",
  "7d": "7 days",
  "30d": "30 days",
  "90d": "90 days",
  never: "Never",
};

function expiryText(expiresAt: string | null): string {
  if (!expiresAt) return "Never expires";
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return "Expired";
  const days = Math.ceil(ms / (24 * 60 * 60 * 1000));
  return days === 1 ? "Expires in 1 day" : `Expires in ${days} days`;
}

function TokenRow({ token, onRevoke, busy }: { token: ApiToken; onRevoke: () => void; busy: boolean }) {
  const revoked = token.revokedAt !== null;
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-border p-3">
      <div className="min-w-0 space-y-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium">{token.name}</p>
          <Badge variant="outline">{SCOPE_LABELS[token.scope]}</Badge>
          {revoked && <Badge variant="destructive">Revoked</Badge>}
        </div>
        <p className="text-xs text-muted-foreground">
          {revoked ? "Revoked" : expiryText(token.expiresAt)} ·{" "}
          {token.lastUsedAt ? `Last used ${new Date(token.lastUsedAt).toLocaleString()}` : "Never used"}
        </p>
      </div>
      {!revoked && (
        <Button variant="ghost" size="icon-sm" title="Revoke token" onClick={onRevoke} disabled={busy}>
          <Trash2 className="size-3.5 text-destructive" />
        </Button>
      )}
    </div>
  );
}

const EMPTY_FORM: CreateTokenInput = { name: "", scope: "read_write", expiresIn: "never" };

export function TokensPage() {
  const [tokens, setTokens] = useState<ApiToken[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<CreateTokenInput>(EMPTY_FORM);
  // The raw value is only ever available once, right after creation — held
  // here purely for the one-time "copy this now" card, never persisted.
  const [justCreated, setJustCreated] = useState<string | null>(null);

  function refresh() {
    api
      .listTokens()
      .then(setTokens)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load tokens."));
  }

  useEffect(refresh, []);

  async function handleCreate() {
    if (!form.name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const created = await api.createToken({ ...form, name: form.name.trim() });
      setJustCreated(created.token);
      setForm(EMPTY_FORM);
      setCreating(false);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create token.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRevoke(id: string) {
    if (!window.confirm("Revoke this token? Anything using it — including a signed-in browser — loses access immediately.")) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.revokeToken(id);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke token.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col gap-4 overflow-y-auto pb-8">
      <div>
        <h2 className="text-lg font-semibold leading-tight">Tokens</h2>
        <p className="text-sm text-muted-foreground">
          Credentials for the web UI, MCP clients, and agents. One credential type for everything.
        </p>
      </div>

      {justCreated && (
        <Card className="border-primary/40">
          <CardHeader>
            <CardTitle className="text-sm">Copy this token now</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-xs text-muted-foreground">
              It won't be shown again — only revoke-and-recreate if you lose it.
            </p>
            <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-2.5">
              <code className="flex-1 overflow-x-auto text-xs whitespace-pre">{justCreated}</code>
              <CopyButton text={justCreated} size="sm" />
            </div>
            <Button variant="ghost" size="sm" onClick={() => setJustCreated(null)}>
              Done
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{creating ? "New token" : "All tokens"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {creating ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="token-name">Name</Label>
                <Input
                  id="token-name"
                  placeholder="e.g. MacBook, cloud agent"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="token-scope">Scope</Label>
                <Select
                  value={form.scope}
                  onValueChange={(v) => setForm({ ...form, scope: v as TokenScope })}
                >
                  <SelectTrigger id="token-scope" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(SCOPE_LABELS) as TokenScope[]).map((scope) => (
                      <SelectItem key={scope} value={scope}>
                        {SCOPE_LABELS[scope]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="token-expiry">Expires</Label>
                <Select
                  value={form.expiresIn}
                  onValueChange={(v) => setForm({ ...form, expiresIn: v as ExpirationOption })}
                >
                  <SelectTrigger id="token-expiry" className="w-full">
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
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setCreating(false)} disabled={busy}>
                  Cancel
                </Button>
                <Button onClick={handleCreate} disabled={busy || !form.name.trim()}>
                  {busy ? "Creating…" : "Create"}
                </Button>
              </div>
            </div>
          ) : (
            <>
              {tokens === null && <p className="text-sm text-muted-foreground">Loading…</p>}
              {tokens !== null && tokens.length === 0 && (
                <p className="text-sm text-muted-foreground">No tokens yet.</p>
              )}
              {tokens !== null && tokens.length > 0 && (
                <div className="space-y-2">
                  {tokens.map((token) => (
                    <TokenRow key={token.id} token={token} busy={busy} onRevoke={() => handleRevoke(token.id)} />
                  ))}
                </div>
              )}
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setCreating(true)}>
                <Plus className="size-3.5" />
                New token
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

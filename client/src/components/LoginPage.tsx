import { useState } from "react";
import { api } from "@/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Brain } from "lucide-react";

// Shown by AuthGate whenever there's no valid session cookie yet. The token
// pasted here is either a real one from the Tokens page (an existing admin
// session created it) or, for the very first login on a fresh deployment,
// the DAMS_ADMIN_TOKEN bootstrap secret set via `wrangler secret put`.
export function LoginPage({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.login(token.trim());
      onLoggedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <div
            className="glow-ring mb-2 flex size-9 items-center justify-center rounded-lg"
            style={{ "--glow-color": "var(--accent-blue)", backgroundColor: "var(--primary)" } as React.CSSProperties}
          >
            <Brain className="size-4.5 text-primary-foreground" />
          </div>
          <CardTitle>DAMS</CardTitle>
          <CardDescription>Paste a token to sign in.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <Label htmlFor="login-token">Token</Label>
              <Input
                id="login-token"
                type="password"
                autoComplete="current-password"
                placeholder="dams_…"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                autoFocus
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={busy || !token.trim()}>
              {busy ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

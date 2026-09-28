import { useEffect, useState } from "react";
import { api, type AuthIdentity } from "@/api";
import { LoginPage } from "@/components/LoginPage";

type Status =
  | { kind: "loading" }
  | { kind: "authenticated"; identity: AuthIdentity }
  | { kind: "unauthenticated" };

// Wraps <App/> only (see main.tsx) — <ShareView/> is public and token-in-URL
// authed, unaffected by any of this. GET /api/auth/me rejects with a
// 401-flavored Error when there's no valid session cookie yet (or a bearer
// header, not applicable to a browser tab); that's the expected "not signed
// in" case here, not a failure to surface.
export function AuthGate({
  children,
}: {
  children: (identity: AuthIdentity, onLogout: () => void) => React.ReactNode;
}) {
  const [status, setStatus] = useState<Status>({ kind: "loading" });

  function checkSession() {
    api
      .me()
      .then((identity) => setStatus({ kind: "authenticated", identity }))
      .catch(() => setStatus({ kind: "unauthenticated" }));
  }

  useEffect(checkSession, []);

  if (status.kind === "loading") return null;
  if (status.kind === "unauthenticated") return <LoginPage onLoggedIn={checkSession} />;

  return (
    <>
      {children(status.identity, () => {
        api.logout().finally(() => setStatus({ kind: "unauthenticated" }));
      })}
    </>
  );
}

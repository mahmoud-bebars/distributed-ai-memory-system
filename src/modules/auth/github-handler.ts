import type { AuthRequest } from "@cloudflare/workers-oauth-provider";
import { Hono } from "hono";
import type { Context } from "hono";
import type { Bindings } from "../../lib/bindings";
import {
  fetchGitHubUser,
  fetchUpstreamAuthToken,
  getUpstreamAuthorizeUrl,
  type Props,
} from "./utils";
import {
  addApprovedClient,
  bindStateToSession,
  createOAuthState,
  generateCSRFProtection,
  isClientApproved,
  OAuthError,
  renderApprovalDialog,
  validateCSRFToken,
  validateOAuthState,
} from "./workers-oauth-utils";

const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";

/**
 * GitHub upstream OAuth handler for the `/mcp` route.
 *
 * These routes are mounted into the main Worker app, which serves as the
 * OAuthProvider `defaultHandler`. They implement the browser-facing half of
 * the flow (consent dialog → redirect to GitHub → callback), while the
 * provider itself implements the machine-facing `/token` and `/register`
 * endpoints. The single-user allow-list is enforced in `/callback`, the only
 * point where GitHub has told us who actually logged in.
 */
export const githubAuthRoutes = new Hono<{ Bindings: Bindings }>();

async function redirectToGithub(
  c: Context<{ Bindings: Bindings }>,
  stateToken: string,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  return new Response(null, {
    status: 302,
    headers: {
      ...extraHeaders,
      location: getUpstreamAuthorizeUrl({
        client_id: c.env.GITHUB_CLIENT_ID,
        redirect_uri: new URL("/callback", c.req.url).href,
        scope: "read:user",
        state: stateToken,
        upstream_url: GITHUB_AUTHORIZE_URL,
      }),
    },
  });
}

githubAuthRoutes.get("/authorize", async (c) => {
  const oauthReqInfo = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
  const { clientId } = oauthReqInfo;
  if (!clientId) return c.text("Invalid request", 400);

  // Skip the consent dialog for clients this browser has already approved,
  // but still mint fresh, session-bound state to guard the callback.
  if (await isClientApproved(c.req.raw, clientId, c.env.COOKIE_ENCRYPTION_KEY)) {
    const { stateToken } = await createOAuthState(oauthReqInfo, c.env.OAUTH_KV);
    const { setCookie } = await bindStateToSession(stateToken);
    return redirectToGithub(c, stateToken, { "Set-Cookie": setCookie });
  }

  const { token: csrfToken, setCookie } = generateCSRFProtection();
  return renderApprovalDialog(c.req.raw, {
    client: await c.env.OAUTH_PROVIDER.lookupClient(clientId),
    csrfToken,
    server: {
      name: "distributed-ai-memory-system",
      description: "Personal cross-provider memory server — MCP endpoint.",
    },
    setCookie,
    state: { oauthReqInfo },
  });
});

githubAuthRoutes.post("/authorize", async (c) => {
  try {
    const formData = await c.req.raw.formData();
    validateCSRFToken(formData, c.req.raw);

    const encodedState = formData.get("state");
    if (!encodedState || typeof encodedState !== "string") {
      return c.text("Missing state in form data", 400);
    }

    let state: { oauthReqInfo?: AuthRequest };
    try {
      state = JSON.parse(atob(encodedState)) as { oauthReqInfo?: AuthRequest };
    } catch {
      return c.text("Invalid state data", 400);
    }
    if (!state.oauthReqInfo || !state.oauthReqInfo.clientId) {
      return c.text("Invalid request", 400);
    }

    const approvedClientCookie = await addApprovedClient(
      c.req.raw,
      state.oauthReqInfo.clientId,
      c.env.COOKIE_ENCRYPTION_KEY,
    );
    const { stateToken } = await createOAuthState(state.oauthReqInfo, c.env.OAUTH_KV);
    const { setCookie: sessionBindingCookie } = await bindStateToSession(stateToken);

    const headers = new Headers();
    headers.append("Set-Cookie", approvedClientCookie);
    headers.append("Set-Cookie", sessionBindingCookie);

    return redirectToGithub(c, stateToken, Object.fromEntries(headers));
  } catch (error) {
    if (error instanceof OAuthError) return error.toResponse();
    const message = error instanceof Error ? error.message : "Unknown error";
    return c.text(`Internal server error: ${message}`, 500);
  }
});

githubAuthRoutes.get("/callback", async (c) => {
  // Validate the state against both KV and the session-binding cookie.
  let oauthReqInfo: AuthRequest;
  let clearSessionCookie: string;
  try {
    const result = await validateOAuthState(c.req.raw, c.env.OAUTH_KV);
    oauthReqInfo = result.oauthReqInfo;
    clearSessionCookie = result.clearCookie;
  } catch (error) {
    if (error instanceof OAuthError) return error.toResponse();
    return c.text("Internal server error", 500);
  }

  if (!oauthReqInfo.clientId) return c.text("Invalid OAuth request data", 400);

  const [accessToken, errResponse] = await fetchUpstreamAuthToken({
    client_id: c.env.GITHUB_CLIENT_ID,
    client_secret: c.env.GITHUB_CLIENT_SECRET,
    code: c.req.query("code"),
    redirect_uri: new URL("/callback", c.req.url).href,
    upstream_url: GITHUB_TOKEN_URL,
  });
  if (errResponse) return errResponse;

  const { login, name, email } = await fetchGitHubUser(accessToken);

  // Single-user allow-list. This is the earliest point we know the real
  // GitHub identity, so the gate lives here: anyone else authenticates with
  // GitHub fine but never gets an access token for this server.
  if (login !== c.env.ALLOWED_GITHUB_USER) {
    return c.text("Forbidden: this GitHub account is not allow-listed for this server.", 403);
  }

  const props: Props = { login, name, email, accessToken };
  const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
    request: oauthReqInfo,
    userId: login,
    metadata: { label: name ?? login },
    scope: oauthReqInfo.scope,
    props,
  });

  const headers = new Headers({ Location: redirectTo });
  if (clearSessionCookie) headers.set("Set-Cookie", clearSessionCookie);
  return new Response(null, { status: 302, headers });
});

// Upstream (GitHub) OAuth helpers. Mirrors Cloudflare's
// remote-mcp-github-oauth reference, but uses plain `fetch` against the
// GitHub REST API instead of pulling in the Octokit SDK — consistent with how
// ChatService talks to the Anthropic API directly.

/**
 * Props encrypted into the issued access token and exposed to the wrapped
 * handler as `ctx.props`. Holds the authenticated GitHub identity so tools
 * (or logging) can see who's calling without another round-trip.
 */
export interface Props {
  login: string;
  name: string | null;
  email: string | null;
  accessToken: string;
  [key: string]: unknown;
}

/** Builds the GitHub authorize URL to redirect the user's browser to. */
export function getUpstreamAuthorizeUrl({
  upstream_url,
  client_id,
  scope,
  redirect_uri,
  state,
}: {
  upstream_url: string;
  client_id: string;
  scope: string;
  redirect_uri: string;
  state?: string;
}): string {
  const upstream = new URL(upstream_url);
  upstream.searchParams.set("client_id", client_id);
  upstream.searchParams.set("redirect_uri", redirect_uri);
  upstream.searchParams.set("scope", scope);
  if (state) upstream.searchParams.set("state", state);
  upstream.searchParams.set("response_type", "code");
  return upstream.href;
}

/**
 * Exchanges the temporary authorization code for a GitHub access token.
 * Returns `[accessToken, null]` on success or `[null, errorResponse]` on
 * failure, so callers can early-return the error response as-is.
 */
export async function fetchUpstreamAuthToken({
  client_id,
  client_secret,
  code,
  redirect_uri,
  upstream_url,
}: {
  code: string | undefined;
  upstream_url: string;
  client_secret: string;
  redirect_uri: string;
  client_id: string;
}): Promise<[string, null] | [null, Response]> {
  if (!code) {
    return [null, new Response("Missing code", { status: 400 })];
  }

  const resp = await fetch(upstream_url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ client_id, client_secret, code, redirect_uri }).toString(),
  });
  if (!resp.ok) {
    return [null, new Response("Failed to fetch access token", { status: 500 })];
  }

  const body = (await resp.json()) as { access_token?: string };
  if (!body.access_token) {
    return [null, new Response("Missing access token", { status: 400 })];
  }
  return [body.access_token, null];
}

/** Fetches the authenticated user's GitHub profile using their access token. */
export async function fetchGitHubUser(
  accessToken: string,
): Promise<Pick<Props, "login" | "name" | "email">> {
  const resp = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
      // GitHub rejects API requests without a User-Agent.
      "User-Agent": "distributed-ai-memory-system",
    },
  });
  if (!resp.ok) {
    throw new Error(`GitHub user lookup failed (${resp.status})`);
  }
  const data = (await resp.json()) as { login: string; name: string | null; email: string | null };
  return { login: data.login, name: data.name, email: data.email };
}

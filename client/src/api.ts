export interface Project {
  slug: string;
  title: string;
  summary: string | null;
  tags: string;
  r2Key: string;
  entityCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryEntry {
  id: string;
  type: "entity" | "relation" | "observation";
  content: Record<string, unknown>;
  created_at?: string;
}

// A memory entry or doc the model actually pulled in via an executed
// search_memory/search_docs/read_doc tool call this turn — not a
// self-reported citation, grounded in what the backend really fetched (see
// server/src/modules/chat/service.ts). Mirrors the server's ChatSource type;
// duplicated here rather than imported since the client doesn't build
// against the server's source tree (same convention as currentEntities).
export type ChatSource =
  | { kind: "memory"; id: string; type: MemoryEntry["type"]; summary: string }
  | { kind: "doc"; filename: string; snippet: string };

// A mutating doc edit the model proposed mid-conversation but did NOT
// execute — see server/src/modules/chat/service.ts. ChatPanel renders this
// as an Approve/Reject card; only Approve calls the real doc routes below.
export type ProposedAction =
  | { tool: "update_doc"; input: { filename: string; content: string } }
  | { tool: "delete_doc"; input: { filename: string } };

// A prior turn ChatPanel already holds (and has persisted to localStorage —
// see lib/chatStorage.ts) — replayed back to the server on each new
// question so a conversation can carry on across separate questions despite
// there being no server-side chat session/store. Capped client-side to a
// handful of exchanges; the server caps it again (chatHistoryTurnSchema).
export interface ChatHistoryTurn {
  role: "user" | "assistant";
  text: string;
}

// The SSE event vocabulary POST /chat now streams instead of returning one
// JSON blob — mirrors server/src/modules/chat/schema.ts's ChatStreamEvent.
export type ChatStreamEvent =
  | { type: "status"; label: string }
  | { type: "text"; delta: string }
  | { type: "sources"; sources: ChatSource[] }
  | { type: "proposedAction"; action: ProposedAction }
  | { type: "done" }
  | { type: "error"; message: string };

export interface ChatStreamHandlers {
  onStatus: (label: string) => void;
  onTextDelta: (delta: string) => void;
  onSources: (sources: ChatSource[]) => void;
  onProposedAction: (action: ProposedAction) => void;
  onError: (message: string) => void;
  onDone: () => void;
}

export type ExpirationOption = "1d" | "7d" | "30d" | "90d" | "never";

export interface ShareLinkInput {
  label?: string;
  allowChat: boolean;
  allowDocs: boolean;
  // Required on create; omitting it on update means "leave the current
  // expiration alone" rather than resetting it to never (matches the
  // backend's updateShareLinkSchema).
  expiresIn?: ExpirationOption;
}

export interface ShareLink {
  token: string;
  slug: string;
  label: string | null;
  allowChat: boolean;
  allowDocs: boolean;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  url: string;
}

export interface ShareMeta {
  project: { slug: string; title: string; summary: string | null };
  label: string | null;
  allowChat: boolean;
  allowDocs: boolean;
}

// Mirrors the server's tokenScopeSchema (server/src/modules/tokens/schema.ts).
export type TokenScope = "admin" | "read_write" | "read_only";

export interface AuthIdentity {
  name: string;
  scope: TokenScope;
}

export interface ApiToken {
  id: string;
  name: string;
  scope: TokenScope;
  // Null means "all projects" (today's default). Otherwise the exhaustive
  // list of project slugs this token may see or act on.
  projects: string[] | null;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface CreateTokenInput {
  name: string;
  scope: TokenScope;
  expiresIn: ExpirationOption;
  // Omit entirely for an unrestricted (all-projects) token. The server
  // rejects this alongside scope "admin" — admin tokens stay global.
  projects?: string[];
}

/** Reads an SSE response body (from hono/streaming's streamSSE) and invokes
 *  `handlers` per event as it arrives. Hand-rolled rather than `EventSource`
 *  because this is a POST with a JSON body — EventSource only does GET.
 *  Only the `data:` line of each frame is parsed; the `event:` line (if
 *  Hono ever writes one) is ignored, since our own event shape already
 *  carries a `type` discriminant in the JSON payload. */
async function consumeChatStream(response: Response, handlers: ChatStreamHandlers): Promise<void> {
  if (!response.ok || !response.body) {
    let detail = String(response.status);
    try {
      const body = (await response.json()) as { error?: unknown };
      if (typeof body.error === "string") detail = body.error;
    } catch {
      // Non-JSON body — keep the status code.
    }
    handlers.onError(detail);
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finished = false;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let frameEnd = buffer.indexOf("\n\n");
      while (frameEnd !== -1) {
        const frame = buffer.slice(0, frameEnd);
        buffer = buffer.slice(frameEnd + 2);

        const dataLine = frame.split("\n").find((line) => line.startsWith("data:"));
        if (dataLine) {
          try {
            const event = JSON.parse(dataLine.slice(5).trim()) as ChatStreamEvent;
            switch (event.type) {
              case "status":
                handlers.onStatus(event.label);
                break;
              case "text":
                handlers.onTextDelta(event.delta);
                break;
              case "sources":
                handlers.onSources(event.sources);
                break;
              case "proposedAction":
                handlers.onProposedAction(event.action);
                break;
              case "error":
                finished = true;
                handlers.onError(event.message);
                break;
              case "done":
                finished = true;
                handlers.onDone();
                break;
            }
          } catch {
            // Malformed frame — skip it rather than abort the whole stream.
          }
        }

        frameEnd = buffer.indexOf("\n\n");
      }
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return;
    handlers.onError(err instanceof Error ? err.message : "Connection lost");
    return;
  }

  // The connection closed without a done/error frame (e.g. the Worker was
  // killed mid-response) — still clear the caller's loading state instead
  // of leaving it spinning forever.
  if (!finished) handlers.onDone();
}

interface ChatStreamOpts {
  docFilename?: string;
  history?: ChatHistoryTurn[];
}

/** Shared by streamChat/streamShareChat — a rejected fetch (network error,
 *  or the caller's own AbortController firing before a response even comes
 *  back) needs the same onError/no-op-on-abort handling consumeChatStream
 *  already gives a response that resolved but failed mid-stream. */
async function postChatStream(
  path: string,
  body: Record<string, unknown>,
  handlers: ChatStreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return;
    handlers.onError(err instanceof Error ? err.message : "Failed to reach the server");
    return;
  }
  await consumeChatStream(response, handlers);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    headers: { "content-type": "application/json" },
    ...init,
  });
  if (!response.ok) {
    // Surface the server's { error } message when there is one, so failures
    // like a duplicate slug read as the actual reason rather than a bare 500.
    let detail = String(response.status);
    try {
      const body = (await response.json()) as { error?: unknown };
      if (typeof body.error === "string") detail = body.error;
    } catch {
      // Non-JSON body — keep the status code.
    }
    throw new Error(`Request to ${path} failed: ${detail}`);
  }
  return response.json() as Promise<T>;
}

export const api = {
  listProjects: () => request<Project[]>("/projects"),
  createProject: (input: { slug: string; title: string; summary?: string; tags: string[] }) =>
    request<Project>("/projects", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  /** Title/summary/tags are editable after creation — the slug alone is
   *  permanent (it's how MCP tools address the project). */
  updateProject: (slug: string, input: { title: string; summary: string; tags: string[] }) =>
    request<Project>(`/projects/${slug}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  getMemory: (slug: string) => request<MemoryEntry[]>(`/projects/${slug}/memory`),
  /** Streams a chat turn as SSE events instead of one JSON response — see
   *  ChatStreamHandlers. `docFilename` scopes the chat's doc context to
   *  just that one file (memory always stays search-driven); `history` is
   *  the capped window of prior turns ChatPanel replays for continuity,
   *  since there's no server-side chat session. Resolves once the stream
   *  ends (after onDone or onError has fired), never rejects — network and
   *  HTTP failures also come through `onError`. */
  streamChat: (
    slug: string,
    question: string,
    opts: ChatStreamOpts,
    handlers: ChatStreamHandlers,
    signal?: AbortSignal,
  ) => postChatStream(`/projects/${slug}/chat`, { question, ...opts }, handlers, signal),
  /** Fetches the raw memory.jsonl bytes for download — not re-serialized JSON. */
  downloadMemoryRaw: async (slug: string): Promise<Blob> => {
    const response = await fetch(`/api/projects/${slug}/memory/raw`);
    if (!response.ok) throw new Error(`Failed to fetch raw memory: ${response.status}`);
    return response.blob();
  },
  getDocs: (slug: string) => request<{ filenames: string[] }>(`/projects/${slug}/docs`),
  getDoc: async (slug: string, filename: string): Promise<string> => {
    const response = await fetch(`/api/projects/${slug}/docs/${encodeURIComponent(filename)}`);
    if (!response.ok) throw new Error(`Failed to fetch doc: ${response.status}`);
    return response.text();
  },
  /** Creates the doc if it doesn't exist yet, otherwise appends — the same
   *  append-only semantics as the append_doc MCP tool (see DocsService). */
  appendDoc: (slug: string, filename: string, content: string) =>
    request<{ ok: true }>(`/projects/${slug}/docs`, {
      method: "POST",
      body: JSON.stringify({ filename, content }),
    }),
  /** Full-overwrite replace — the Approve action for a proposed update_doc
   *  edit calls this (PUT), never the append-only POST above. */
  updateDoc: (slug: string, filename: string, content: string) =>
    request<{ ok: true }>(`/projects/${slug}/docs/${encodeURIComponent(filename)}`, {
      method: "PUT",
      body: JSON.stringify({ content }),
    }),
  deleteDoc: (slug: string, filename: string) =>
    request<{ ok: true }>(`/projects/${slug}/docs/${encodeURIComponent(filename)}`, {
      method: "DELETE",
    }),
  /** A project can have any number of independently configured share
   *  links — this lists all of them, newest first, expired ones included
   *  (the manager UI shows "expired" rather than silently dropping them). */
  listShareLinks: (slug: string) => request<ShareLink[]>(`/projects/${slug}/share`),
  createShareLink: (slug: string, input: ShareLinkInput) =>
    request<ShareLink>(`/projects/${slug}/share`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  /** Every field but the token is editable — label, chat/docs toggles, and
   *  expiration all update in place without changing the link itself. */
  updateShareLink: (slug: string, token: string, input: ShareLinkInput) =>
    request<ShareLink>(`/projects/${slug}/share/${token}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  revokeShareLink: (slug: string, token: string) =>
    request<{ ok: true }>(`/projects/${slug}/share/${token}`, { method: "DELETE" }),
  /** Public, token-authed — no session, no cookies. Tells the share page
   *  which tabs it's allowed to show (Docs/Chat gated per-link) before it
   *  fetches anything else. */
  getShareMeta: (token: string) => request<ShareMeta>(`/share/${token}`),
  /** Public read-only endpoint behind a share token — no auth, same shape
   *  as the authenticated memory endpoint. */
  getShareMemory: (token: string) => request<MemoryEntry[]>(`/share/${token}/memory`),
  /** Public read-only doc listing/content behind a share token — mirrors
   *  getDocs/getDoc above, but there is no share-side append/update/delete:
   *  the backend only exposes GET on these, so a share link can't mutate
   *  docs regardless of what the frontend renders. */
  getShareDocs: (token: string) => request<{ filenames: string[] }>(`/share/${token}/docs`),
  getShareDoc: async (token: string, filename: string): Promise<string> => {
    const response = await fetch(`/api/share/${token}/docs/${encodeURIComponent(filename)}`);
    if (!response.ok) throw new Error(`Failed to fetch doc: ${response.status}`);
    return response.text();
  },
  /** Only reachable when the link's allowChat is on — 404s otherwise, same
   *  as an invalid token would. Uses the project owner's Anthropic key. */
  streamShareChat: (
    token: string,
    question: string,
    opts: ChatStreamOpts,
    handlers: ChatStreamHandlers,
    signal?: AbortSignal,
  ) => postChatStream(`/share/${token}/chat`, { question, ...opts }, handlers, signal),
  /** Exchanges a raw token for the httpOnly session cookie — see
   *  server/src/modules/tokens/routes.ts. Every other `request()` call above
   *  already rides that cookie for free (default same-origin fetch
   *  credentials), so nothing else in this file needed to change for auth. */
  login: (token: string) => request<AuthIdentity>("/auth/login", { method: "POST", body: JSON.stringify({ token }) }),
  logout: () => request<{ ok: true }>("/auth/logout", { method: "POST" }),
  /** Rejects with a 401-flavored Error when there's no valid session/bearer
   *  credential yet — AuthGate treats that as "show the login page", not as
   *  an unexpected failure. */
  me: () => request<AuthIdentity>("/auth/me"),
  listTokens: () => request<ApiToken[]>("/tokens"),
  createToken: (input: CreateTokenInput) =>
    request<ApiToken & { token: string }>("/tokens", { method: "POST", body: JSON.stringify(input) }),
  revokeToken: (id: string) => request<{ ok: true }>(`/tokens/${id}`, { method: "DELETE" }),
};

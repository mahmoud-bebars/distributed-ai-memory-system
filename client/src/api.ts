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

// A memory entry the model reports it drew on to answer — not a retrieval
// result, a citation (see src/modules/chat/service.ts's extractSources).
export interface ChatSource {
  id: string;
  type: MemoryEntry["type"];
  summary: string;
}

// A mutating doc edit the model proposed mid-conversation but did NOT
// execute — see src/modules/chat/service.ts's extractProposedAction.
// ChatPanel renders this as an Approve/Reject card; only Approve calls the
// real doc routes below.
export type ProposedAction =
  | { tool: "update_doc"; input: { filename: string; content: string } }
  | { tool: "delete_doc"; input: { filename: string } };

export interface ChatResponse {
  answer: string;
  sources: ChatSource[];
  proposedAction?: ProposedAction;
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
  /** `docFilename` scopes the chat's doc context to just that one file
   *  instead of every doc in the project — memory is always included in
   *  full either way. */
  askChat: (slug: string, question: string, docFilename?: string) =>
    request<ChatResponse>(`/projects/${slug}/chat`, {
      method: "POST",
      body: JSON.stringify({ question, ...(docFilename ? { docFilename } : {}) }),
    }),
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
  askShareChat: (token: string, question: string, docFilename?: string) =>
    request<ChatResponse>(`/share/${token}/chat`, {
      method: "POST",
      body: JSON.stringify({ question, ...(docFilename ? { docFilename } : {}) }),
    }),
};

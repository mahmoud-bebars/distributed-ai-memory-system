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

export type ShareStatus = { active: false } | { active: true; token: string; url: string };

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
  createProject: (input: { slug: string; title: string; tags: string[] }) =>
    request<Project>("/projects", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  getMemory: (slug: string) => request<MemoryEntry[]>(`/projects/${slug}/memory`),
  askChat: (slug: string, question: string) =>
    request<ChatResponse>(`/projects/${slug}/chat`, {
      method: "POST",
      body: JSON.stringify({ question }),
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
  getShareStatus: (slug: string) => request<ShareStatus>(`/projects/${slug}/share`),
  createShare: (slug: string) =>
    request<{ token: string; url: string }>(`/projects/${slug}/share`, { method: "POST" }),
  revokeShare: (slug: string) =>
    request<{ ok: true }>(`/projects/${slug}/share`, { method: "DELETE" }),
  /** Public read-only endpoint behind a share token — no auth, same shape
   *  as the authenticated memory endpoint. */
  getShareMemory: (token: string) => request<MemoryEntry[]>(`/share/${token}/memory`),
};

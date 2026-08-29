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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    headers: { "content-type": "application/json" },
    ...init,
  });
  if (!response.ok) {
    throw new Error(`Request to ${path} failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export const api = {
  listProjects: () => request<Project[]>("/projects"),
  getMemory: (slug: string) => request<MemoryEntry[]>(`/projects/${slug}/memory`),
  askChat: (slug: string, question: string) =>
    request<{ answer: string }>(`/projects/${slug}/chat`, {
      method: "POST",
      body: JSON.stringify({ question }),
    }),
};

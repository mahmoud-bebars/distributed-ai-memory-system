import type { MemoryEntry } from "../projects/schema";

const MAX_INDEXED_CHARS = 2000;

/** The searchable text of an entry: every string/number value in its
 *  content, in key order (entity `name` first by convention, then
 *  `category`, observation `text`, relation source/label/target...). Arabic
 *  and any other script pass through untouched. */
export function entryText(entry: MemoryEntry): string {
  const parts: string[] = [];
  for (const value of Object.values(entry.content)) {
    if (typeof value === "string" || typeof value === "number") parts.push(String(value));
    else if (Array.isArray(value)) {
      for (const item of value) if (typeof item === "string" || typeof item === "number") parts.push(String(item));
    }
  }
  return parts.join(" ").trim().slice(0, MAX_INDEXED_CHARS);
}

/** Stable index key (also the Vectorize vector id — max 64 bytes, so a
 *  128-bit hex hash). Entity identity is project + name, matching
 *  `currentEntities` (last-write-wins): a new revision overwrites the old
 *  one's vector and FTS row instead of leaving a stale duplicate. Every
 *  other entry is project + entry id. */
export async function indexKey(projectSlug: string, entry: MemoryEntry): Promise<string> {
  const identity =
    entry.type === "entity"
      ? `${projectSlug}\u0000entity\u0000${String(entry.content.name ?? entry.id)}`
      : `${projectSlug}\u0000${entry.id}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity));
  return Array.from(new Uint8Array(digest))
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Rough token estimate for the Workers AI budget counter — deliberately
 *  pessimistic (3 chars/token) since Arabic tokenizes heavier than English. */
export const estimateTokens = (text: string): number => Math.ceil(text.length / 3);

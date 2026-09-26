import type { ChatSource, ProposedAction } from "@/api";

export type ActionStatus = "pending" | "approved" | "rejected" | "error";

export interface StoredMessage {
  role: "user" | "assistant";
  text: string;
  sources?: ChatSource[];
  proposedAction?: ProposedAction;
  actionStatus?: ActionStatus;
  actionError?: string;
}

const MAX_STORED_MESSAGES = 50;

/** First use of localStorage for actual app data in this codebase (the one
 *  prior usage, theme-provider.tsx, is just a UI preference string) — chat
 *  history lives in the browser, not the server/D1, per design. Both
 *  functions degrade to a no-op on any failure (private browsing, quota,
 *  disabled storage) rather than let a chat panel crash over persistence. */
export function loadMessages(key: string): StoredMessage[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as StoredMessage[]) : [];
  } catch {
    return [];
  }
}

export function saveMessages(key: string, messages: StoredMessage[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(messages.slice(-MAX_STORED_MESSAGES)));
  } catch {
    // Quota exceeded or storage unavailable — chat still works in-memory
    // for this session, it just won't survive a refresh.
  }
}

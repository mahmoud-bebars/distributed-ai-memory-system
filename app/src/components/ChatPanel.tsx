import { useState, type FormEvent } from "react";
import { api, type ChatSource, type ProposedAction } from "@/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { renderMarkdown } from "@/lib/markdown";
import { TYPE_BADGE_VARIANT } from "@/lib/memory";

type ActionStatus = "pending" | "approved" | "rejected" | "error";

interface Message {
  role: "user" | "assistant";
  text: string;
  sources?: ChatSource[];
  proposedAction?: ProposedAction;
  actionStatus?: ActionStatus;
  actionError?: string;
}

// Renders a mutating doc edit the model proposed but did NOT execute (see
// src/modules/chat/service.ts) as an explicit Approve/Reject card. Approve
// is the only path that ever calls the real write/delete route — rejecting,
// or just not clicking anything, leaves the project untouched.
function ProposedActionCard({
  action,
  status,
  error,
  onApprove,
  onReject,
}: {
  action: ProposedAction;
  status: ActionStatus;
  error?: string;
  onApprove: () => void;
  onReject: () => void;
}) {
  return (
    <div className="mt-1.5 max-w-[85%] rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
      <p className="font-medium">
        {action.tool === "update_doc" ? "Proposed doc edit" : "Proposed doc deletion"}
      </p>
      <p className="mt-1 text-muted-foreground">
        File: <code className="rounded bg-muted px-1 py-0.5">{action.input.filename}</code>
      </p>
      {action.tool === "update_doc" ? (
        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-xs">
          {action.input.content}
        </pre>
      ) : (
        <p className="mt-2 text-xs text-destructive">
          This will permanently delete the file. This cannot be undone.
        </p>
      )}

      {status === "pending" && (
        <div className="mt-2 flex gap-2">
          <Button type="button" size="sm" onClick={onApprove}>
            Approve
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={onReject}>
            Reject
          </Button>
        </div>
      )}
      {status === "approved" && (
        <p className="mt-2 text-xs font-medium text-emerald-600 dark:text-emerald-400">
          Applied.
        </p>
      )}
      {status === "rejected" && (
        <p className="mt-2 text-xs text-muted-foreground">Rejected — no change made.</p>
      )}
      {status === "error" && (
        <p className="mt-2 text-xs text-destructive">Failed to apply: {error}</p>
      )}
    </div>
  );
}

// ChatService.ask dumps every memory entry AND every project doc into its
// context on every question — there's no picker, nothing is excluded. These
// only describe that so it's visible in the UI; neither controls it.
function contextParts(entryCount: number, docCount: number): string[] {
  const parts: string[] = [];
  if (entryCount > 0) parts.push(`${entryCount} memory ${entryCount === 1 ? "entry" : "entries"}`);
  if (docCount > 0) parts.push(`${docCount} ${docCount === 1 ? "doc" : "docs"}`);
  return parts;
}

function contextSummary(entryCount: number, docCount: number): string {
  const parts = contextParts(entryCount, docCount);
  if (parts.length === 0) return "This project has no memory or docs recorded yet.";
  return `This chat sees ${parts.join(" and ")} from this project on every question — nothing to select, it's all included automatically.`;
}

function loadingLabel(entryCount: number, docCount: number): string {
  const parts = contextParts(entryCount, docCount);
  return parts.length === 0 ? "Thinking…" : `Reading ${parts.join(" and ")}…`;
}

export function ChatPanel({
  slug,
  entryCount,
  docCount,
}: {
  slug: string;
  entryCount: number;
  docCount: number;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = question.trim();
    if (!trimmed || loading) return;

    setMessages((prev) => [...prev, { role: "user", text: trimmed }]);
    setQuestion("");
    setLoading(true);
    setError(null);

    try {
      const { answer, sources, proposedAction } = await api.askChat(slug, trimmed);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: answer,
          sources,
          proposedAction,
          actionStatus: proposedAction ? "pending" : undefined,
        },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function handleApprove(index: number, action: ProposedAction) {
    try {
      if (action.tool === "update_doc") {
        await api.updateDoc(slug, action.input.filename, action.input.content);
      } else {
        await api.deleteDoc(slug, action.input.filename);
      }
      setMessages((prev) =>
        prev.map((m, i) => (i === index ? { ...m, actionStatus: "approved" } : m)),
      );
    } catch (err) {
      setMessages((prev) =>
        prev.map((m, i) =>
          i === index
            ? {
                ...m,
                actionStatus: "error",
                actionError: err instanceof Error ? err.message : "Something went wrong",
              }
            : m,
        ),
      );
    }
  }

  function handleReject(index: number) {
    setMessages((prev) =>
      prev.map((m, i) => (i === index ? { ...m, actionStatus: "rejected" } : m)),
    );
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <p className="text-xs text-muted-foreground">{contextSummary(entryCount, docCount)}</p>
      <ScrollArea className="min-h-0 flex-1 rounded-md border">
        <div className="flex flex-col gap-3 p-4">
          {messages.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Ask this project's memory something to get started.
            </p>
          )}
          {messages.map((m, i) => (
            <div key={i} className={m.role === "user" ? "text-right" : "text-left"}>
              {/* A tool-only turn can come back with no text, just a proposed
                  action — skip the empty bubble rather than render blank chrome. */}
              {(m.role === "user" || m.text.length > 0) && (
                <div
                  className={`inline-block max-w-[85%] rounded-lg px-3 py-2 text-left text-sm ${
                    m.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-foreground"
                  }`}
                >
                  {m.role === "assistant" ? renderMarkdown(m.text) : m.text}
                </div>
              )}
              {m.role === "assistant" && m.sources && m.sources.length > 0 && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">
                    Used {m.sources.length} memory {m.sources.length === 1 ? "entry" : "entries"}:
                  </span>
                  {m.sources.map((source) => (
                    <Badge
                      key={source.id}
                      variant={TYPE_BADGE_VARIANT[source.type]}
                      title={source.summary}
                      className="max-w-48 gap-1 font-normal"
                    >
                      <span className="truncate">{source.summary}</span>
                    </Badge>
                  ))}
                </div>
              )}
              {m.role === "assistant" && m.proposedAction && m.actionStatus && (
                <ProposedActionCard
                  action={m.proposedAction}
                  status={m.actionStatus}
                  error={m.actionError}
                  onApprove={() => handleApprove(i, m.proposedAction!)}
                  onReject={() => handleReject(i)}
                />
              )}
            </div>
          ))}
          {loading && (
            <p className="text-sm text-muted-foreground">{loadingLabel(entryCount, docCount)}</p>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      </ScrollArea>
      <form onSubmit={handleSubmit} className="flex gap-2">
        <Input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask this project's memory something…"
        />
        <Button type="submit" disabled={loading}>
          Ask
        </Button>
      </form>
    </div>
  );
}

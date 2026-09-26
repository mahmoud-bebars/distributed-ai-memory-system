import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import {
  api,
  type ChatHistoryTurn,
  type ChatSource,
  type ChatStreamHandlers,
  type MemoryEntry,
  type ProposedAction,
} from "@/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { loadMessages, saveMessages, type StoredMessage } from "@/lib/chatStorage";
import { renderMarkdown } from "@/lib/markdown";
import { categoryColor, categoryOf, resolveSourceEntity } from "@/lib/memory";
import { cn } from "@/lib/utils";
import { SendHorizontal, Sparkles, X } from "lucide-react";
import { FileText, GitBranch, StickyNote } from "lucide-react";

type Message = StoredMessage;
type ActionStatus = NonNullable<Message["actionStatus"]>;

// How much of the conversation to replay back to the server as context for
// the new question — there's no server-side chat session, so this capped
// window of prior turns (see ChatHistoryTurn) is what makes a follow-up
// question feel continuous. Matches the server's own cap
// (chatHistoryTurnSchema.max(10)) — no point sending more than it'll keep.
const MAX_HISTORY_TURNS = 10;

const SOURCE_ICON: Record<MemoryEntry["type"], typeof FileText> = {
  entity: FileText,
  relation: GitBranch,
  observation: StickyNote,
};

// Renders a mutating doc edit the model proposed but did NOT execute (see
// server/src/modules/chat/service.ts) as an explicit Approve/Reject card.
// Approve is the only path that ever calls the real write/delete route —
// rejecting, or just not clicking anything, leaves the project untouched.
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
    <div className="mt-1.5 max-w-[85%] rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
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

// The model now decides for itself, per question, whether to look anything
// up (via search_memory/list_docs/search_docs/read_doc) rather than every
// question front-loading the whole project — this just tells the user
// what's available for it to draw on, not what's already been sent.
function contextSummary(entryCount: number, docCount: number, scopedDoc: string | null): string {
  if (scopedDoc) return `This chat is scoped to just "${scopedDoc}" — memory stays searchable as usual.`;
  if (entryCount === 0 && docCount === 0) return "This project has no memory or docs recorded yet.";
  const parts: string[] = [];
  if (entryCount > 0) parts.push(`${entryCount} memory ${entryCount === 1 ? "entry" : "entries"}`);
  if (docCount > 0) parts.push(`${docCount} ${docCount === 1 ? "doc" : "docs"}`);
  return `This chat can look up whatever's relevant from this project's ${parts.join(" and ")} — it only pulls in what your question actually needs.`;
}

function KeyReferences({
  sources,
  entries,
  onJumpToEntity,
}: {
  sources: ChatSource[];
  entries: MemoryEntry[];
  onJumpToEntity: (name: string) => void;
}) {
  return (
    <div className="mt-2 max-w-[85%] rounded-xl border border-border bg-card p-2.5">
      <p className="mb-1.5 px-0.5 text-xs font-medium text-muted-foreground">
        Key references · {sources.length} {sources.length === 1 ? "source" : "sources"}
      </p>
      <div className="flex flex-col gap-0.5">
        {sources.map((source, i) => {
          if (source.kind === "doc") {
            return (
              <div
                key={`doc-${source.filename}-${i}`}
                title={source.snippet}
                className="flex items-center gap-2 rounded-lg px-1.5 py-1.5 text-left text-xs opacity-80"
              >
                <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate font-mono">{source.filename}</span>
                <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                  doc
                </span>
              </div>
            );
          }

          const Icon = SOURCE_ICON[source.type];
          const entity = entries.find((e) => e.id === source.id);
          const color = entity?.type === "entity" ? categoryColor(categoryOf(entity)) : "var(--muted-foreground)";
          const jumpTarget = resolveSourceEntity(entries, source);
          const clickable = jumpTarget !== null;
          return (
            <button
              key={source.id}
              type="button"
              disabled={!clickable}
              title={clickable ? `Jump to "${jumpTarget}" in the graph` : source.summary}
              onClick={() => jumpTarget && onJumpToEntity(jumpTarget)}
              className={cn(
                "flex items-center gap-2 rounded-lg px-1.5 py-1.5 text-left text-xs",
                clickable ? "glow-hover cursor-pointer hover:bg-muted" : "cursor-default opacity-80"
              )}
              style={{ "--glow-color": color } as React.CSSProperties}
            >
              <Icon className="size-3.5 shrink-0" style={{ color }} />
              <span className="min-w-0 flex-1 truncate">{source.summary}</span>
              <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground capitalize">
                {source.type}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function ChatPanel({
  slug,
  storageKey,
  entries,
  docFilenames,
  onJumpToEntity,
  streamAsk,
}: {
  // Only needed for approving a proposed doc edit (updateDoc/deleteDoc) —
  // undefined in a read-only context (a share link), where the model is
  // never offered those tools in the first place, so proposedAction can
  // never actually occur and this is never read.
  slug?: string;
  // Persists this conversation to localStorage under this key (see
  // lib/chatStorage.ts) — distinct per project/share link so switching
  // between them never mixes histories, and a refresh doesn't lose one.
  storageKey: string;
  entries: MemoryEntry[];
  docFilenames: string[];
  onJumpToEntity: (name: string) => void;
  // Streams the answer as it's generated instead of waiting for the whole
  // thing — the authenticated project route or the public share-token
  // route, depending on where this panel is mounted. Resolves once the
  // turn is fully done (including on error); never rejects.
  streamAsk: (
    question: string,
    docFilename: string | undefined,
    history: ChatHistoryTurn[],
    handlers: ChatStreamHandlers,
    signal: AbortSignal,
  ) => Promise<void>;
}) {
  const [messages, setMessages] = useState<Message[]>(() => loadMessages(storageKey));
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [agentStatus, setAgentStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scopedDoc, setScopedDoc] = useState<string | null>(null);
  const [docPickerOpen, setDocPickerOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const entryCount = entries.length;
  const docCount = docFilenames.length;

  // Reload from this key's own stored history whenever it changes (e.g.
  // switching projects) — ChatPanel isn't remounted on that switch, so this
  // effect is what keeps one project's messages from leaking into another.
  useEffect(() => {
    setMessages(loadMessages(storageKey));
  }, [storageKey]);

  // Abort any in-flight stream if the panel goes away mid-answer.
  useEffect(() => () => abortRef.current?.abort(), []);

  // Switching projects (or the scoped doc getting deleted/renamed) can
  // leave this pointing at a file that's no longer there — drop it rather
  // than silently keep sending a stale filename.
  useEffect(() => {
    if (scopedDoc && !docFilenames.includes(scopedDoc)) setScopedDoc(null);
  }, [docFilenames, scopedDoc]);

  async function submit() {
    const trimmed = question.trim();
    if (!trimmed || loading) return;

    const key = storageKey;
    const priorMessages = messages;
    const historyForRequest: ChatHistoryTurn[] = priorMessages
      .filter((m) => m.text.length > 0)
      .slice(-MAX_HISTORY_TURNS)
      .map((m) => ({ role: m.role, text: m.text }));

    const userMessage: Message = { role: "user", text: trimmed };
    const assistantIndex = priorMessages.length + 1;

    setMessages((prev) => [...prev, userMessage, { role: "assistant", text: "" }]);
    saveMessages(key, [...priorMessages, userMessage, { role: "assistant", text: "" }]);
    setQuestion("");
    setLoading(true);
    setError(null);
    setAgentStatus(null);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    let assistantText = "";
    let assistantSources: ChatSource[] | undefined;
    let assistantAction: ProposedAction | undefined;

    function patchAssistant(patch: Partial<Message>) {
      setMessages((prev) => prev.map((m, i) => (i === assistantIndex ? { ...m, ...patch } : m)));
    }

    function finalize() {
      setLoading(false);
      setAgentStatus(null);
      saveMessages(key, [
        ...priorMessages,
        userMessage,
        {
          role: "assistant",
          text: assistantText,
          sources: assistantSources,
          proposedAction: assistantAction,
          actionStatus: assistantAction ? "pending" : undefined,
        },
      ]);
    }

    await streamAsk(
      trimmed,
      scopedDoc ?? undefined,
      historyForRequest,
      {
        onStatus: (label) => setAgentStatus(label),
        onTextDelta: (delta) => {
          assistantText += delta;
          setAgentStatus(null);
          patchAssistant({ text: assistantText });
        },
        onSources: (sources) => {
          assistantSources = sources;
          patchAssistant({ sources });
        },
        onProposedAction: (action) => {
          assistantAction = action;
          patchAssistant({ proposedAction: action, actionStatus: "pending" });
        },
        onError: (message) => {
          setError(message);
          finalize();
        },
        onDone: finalize,
      },
      controller.signal,
    );
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    void submit();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void submit();
    }
  }

  async function handleApprove(index: number, action: ProposedAction) {
    // Unreachable in practice — a proposedAction can only exist when the
    // model was offered the update_doc/delete_doc tools, which only
    // happens with a project slug in the first place. Guarded anyway
    // rather than asserting, since `slug` is optional on this component.
    if (!slug) return;
    try {
      if (action.tool === "update_doc") {
        await api.updateDoc(slug, action.input.filename, action.input.content);
      } else {
        await api.deleteDoc(slug, action.input.filename);
      }
      setMessages((prev) => {
        const next = prev.map((m, i) => (i === index ? { ...m, actionStatus: "approved" as const } : m));
        saveMessages(storageKey, next);
        return next;
      });
    } catch (err) {
      setMessages((prev) => {
        const next = prev.map((m, i) =>
          i === index
            ? {
                ...m,
                actionStatus: "error" as const,
                actionError: err instanceof Error ? err.message : "Something went wrong",
              }
            : m,
        );
        saveMessages(storageKey, next);
        return next;
      });
    }
  }

  function handleReject(index: number) {
    setMessages((prev) => {
      const next = prev.map((m, i) => (i === index ? { ...m, actionStatus: "rejected" as const } : m));
      saveMessages(storageKey, next);
      return next;
    });
  }

  const lastMessage = messages[messages.length - 1];
  const showThinking = loading && (!lastMessage || lastMessage.role !== "assistant" || lastMessage.text.length === 0);

  return (
    <div className="flex h-full flex-col gap-3">
      <p className="text-xs text-muted-foreground">{contextSummary(entryCount, docCount, scopedDoc)}</p>
      <ScrollArea className="min-h-0 flex-1 rounded-xl border border-border">
        <div className="flex flex-col gap-4 p-4">
          {messages.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Ask this project's memory something to get started.
            </p>
          )}
          {messages.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-tr-sm border border-primary/25 bg-primary/12 px-3.5 py-2 text-sm text-foreground">
                  {m.text}
                </div>
              </div>
            ) : (
              <div key={i} className="flex flex-col items-start">
                {/* A tool-only turn can come back with no text, just a proposed
                    action — skip the empty bubble rather than render blank chrome. */}
                {m.text.length > 0 && (
                  <div className="flex max-w-[85%] items-start gap-2">
                    <span className="glow-ring mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/15" style={{ "--glow-color": "var(--accent-violet)" } as React.CSSProperties}>
                      <Sparkles className="size-3.5 text-primary" />
                    </span>
                    <div className="rounded-2xl rounded-tl-sm border border-border bg-card px-3.5 py-2 text-sm">
                      {renderMarkdown(m.text)}
                    </div>
                  </div>
                )}
                <div className="pl-8">
                  {m.sources && m.sources.length > 0 && (
                    <KeyReferences sources={m.sources} entries={entries} onJumpToEntity={onJumpToEntity} />
                  )}
                  {m.proposedAction && m.actionStatus && (
                    <ProposedActionCard
                      action={m.proposedAction}
                      status={m.actionStatus}
                      error={m.actionError}
                      onApprove={() => handleApprove(i, m.proposedAction!)}
                      onReject={() => handleReject(i)}
                    />
                  )}
                </div>
              </div>
            )
          )}
          {showThinking && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Sparkles className="size-3.5 animate-pulse" />
              {agentStatus ?? "Thinking…"}
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      </ScrollArea>
      {scopedDoc && (
        <Badge variant="secondary" className="w-fit gap-1 pr-1">
          <FileText className="size-3" />
          Scoped to {scopedDoc}
          <button
            type="button"
            onClick={() => setScopedDoc(null)}
            aria-label="Clear doc scope"
            className="rounded-full p-0.5 hover:bg-foreground/15"
          >
            <X className="size-3" />
          </button>
        </Badge>
      )}
      <form onSubmit={handleSubmit} className="flex items-center gap-1.5 rounded-xl border border-border bg-card p-1.5">
        <Popover open={docPickerOpen} onOpenChange={setDocPickerOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant={scopedDoc ? "secondary" : "ghost"}
              size="icon-sm"
              title={scopedDoc ? `Scoped to ${scopedDoc} — click to change` : "Scope this chat to one doc"}
              className="shrink-0"
              disabled={docCount === 0}
            >
              <FileText className="size-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64">
            <p className="px-1 pb-1 text-xs font-medium text-muted-foreground">Scope chat to a doc</p>
            {docFilenames.length === 0 ? (
              <p className="px-1 py-1 text-xs text-muted-foreground">No docs in this project yet.</p>
            ) : (
              <div className="flex flex-col gap-0.5">
                {docFilenames.map((filename) => (
                  <button
                    key={filename}
                    type="button"
                    onClick={() => {
                      setScopedDoc(filename);
                      setDocPickerOpen(false);
                    }}
                    className={cn(
                      "flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted",
                      scopedDoc === filename && "bg-muted font-medium",
                    )}
                  >
                    <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate font-mono">{filename}</span>
                  </button>
                ))}
              </div>
            )}
            {scopedDoc && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mt-1 w-full justify-start gap-1.5 text-muted-foreground"
                onClick={() => {
                  setScopedDoc(null);
                  setDocPickerOpen(false);
                }}
              >
                <X className="size-3.5" />
                Clear — use all docs
              </Button>
            )}
          </PopoverContent>
        </Popover>
        <Input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={scopedDoc ? `Ask about ${scopedDoc}…` : "Ask this project's memory something…"}
          className="border-0 bg-transparent shadow-none focus-visible:ring-0"
        />
        <Button type="submit" size="icon-sm" disabled={loading || !question.trim()} title="Send (⌘⏎)" className="shrink-0">
          <SendHorizontal className="size-4" />
        </Button>
      </form>
    </div>
  );
}

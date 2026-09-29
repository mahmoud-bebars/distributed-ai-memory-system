import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  type AssistantCitation,
  type AssistantMessage,
  type AssistantTask,
  type StoredPlan,
  type TaskStatus,
} from "@/api";
import { PlanCard } from "@/components/PlansPage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, MessageSquarePlus, RotateCw, Send, Sparkles, X } from "lucide-react";

const STATUS_VARIANT: Record<TaskStatus, "default" | "secondary" | "destructive" | "outline"> = {
  planning: "secondary",
  awaiting_approval: "default",
  running: "secondary",
  done: "outline",
  failed: "destructive",
  cancelled: "outline",
  expired: "outline",
};

function Citations({ citations, onOpen }: { citations: AssistantCitation[]; onOpen: (slug: string) => void }) {
  if (citations.length === 0) return null;
  return (
    <div className="mt-2 space-y-1">
      <p className="text-xs font-medium text-muted-foreground">Sources</p>
      {citations.map((c) => (
        <button
          key={`${c.slug}/${c.entryId}`}
          type="button"
          onClick={() => onOpen(c.slug)}
          title={`Open ${c.project}`}
          className="block w-full rounded-lg border border-border bg-background/40 px-3 py-1.5 text-left text-xs transition-colors hover:border-primary/40"
        >
          <span className="font-medium">{c.project}</span>
          <span className="text-muted-foreground"> · {c.entryId.slice(0, 8)} — {c.snippet}</span>
        </button>
      ))}
    </div>
  );
}

// A plan the assistant proposed, embedded in the chat: approving it here goes
// through the exact same server gate as the Plans page (admin only; a
// create_project still needs its slug typed).
function PlanMessage({ planId, onChanged }: { planId: string; onChanged: () => void }) {
  const [plan, setPlan] = useState<StoredPlan | null>(null);
  const load = useCallback(() => {
    api.getPlan(planId).then(setPlan).catch(() => setPlan(null));
  }, [planId]);
  useEffect(load, [load]);
  useEffect(() => {
    if (plan?.status !== "running") return;
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [plan?.status, load]);
  if (!plan) return <p className="text-xs text-muted-foreground">Loading plan…</p>;
  return (
    <PlanCard
      plan={plan}
      onChanged={() => {
        load();
        onChanged();
      }}
    />
  );
}

export function AssistantPage({
  onOpenProject,
  onPlansChanged,
}: {
  onOpenProject: (slug: string) => void;
  onPlansChanged: () => void;
}) {
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [conversations, setConversations] = useState<{ id: string; title: string }[]>([]);
  const [tasks, setTasks] = useState<{ active: AssistantTask[]; recent: AssistantTask[] }>({ active: [], recent: [] });
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  const loadSide = useCallback(() => {
    api.listTasks().then(setTasks).catch(() => {});
    api.listConversations().then(setConversations).catch(() => {});
  }, []);

  useEffect(() => {
    loadSide();
    const t = setInterval(loadSide, 5000);
    return () => clearInterval(t);
  }, [loadSide]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, status]);

  async function openConversation(id: string) {
    setConversationId(id);
    setError(null);
    setMessages(await api.getConversation(id).catch(() => []));
  }

  function newChat() {
    abortRef.current?.abort();
    setConversationId(undefined);
    setMessages([]);
    setError(null);
    setBusy(false);
    setStatus(null);
  }

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setError(null);
    setBusy(true);
    const now = new Date().toISOString();
    const local = (m: Omit<AssistantMessage, "id" | "createdAt" | "citations" | "planId"> & Partial<AssistantMessage>): AssistantMessage => ({
      id: crypto.randomUUID(),
      createdAt: now,
      citations: [],
      planId: null,
      ...m,
    });
    setMessages((prev) => [...prev, local({ role: "user", kind: "text", content: text })]);

    const controller = new AbortController();
    abortRef.current = controller;
    await api.streamAssistant(
      text,
      conversationId,
      (event) => {
        switch (event.type) {
          case "conversation":
            setConversationId(event.id);
            break;
          case "status":
            setStatus(event.label);
            break;
          case "answer":
            setMessages((prev) => [...prev, local({ role: "assistant", kind: "answer", content: event.text, citations: event.citations })]);
            break;
          case "ask":
            setMessages((prev) => [...prev, local({ role: "assistant", kind: "ask", content: event.question })]);
            break;
          case "plan":
            setMessages((prev) => [...prev, local({ role: "assistant", kind: "plan", content: event.summary, planId: event.planId })]);
            onPlansChanged();
            break;
          case "error":
            setError(event.message);
            break;
          case "done":
            break;
        }
      },
      controller.signal,
    );
    setBusy(false);
    setStatus(null);
    loadSide();
  }

  async function taskAction(fn: () => Promise<unknown>) {
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    }
    loadSide();
    onPlansChanged();
  }

  return (
    <div className="mx-auto grid h-full max-w-5xl min-h-0 gap-4 lg:grid-cols-[1fr_18rem]">
      {/* Chat */}
      <div className="flex min-h-0 flex-col">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold leading-tight">
              <Sparkles className="size-4 text-primary" />
              Assistant
            </h2>
            <p className="text-sm text-muted-foreground">
              Searches your projects that opted in to global search (or ones you name). It proposes changes — you approve them.
            </p>
          </div>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={newChat}>
            <MessageSquarePlus className="size-4" />
            New chat
          </Button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto rounded-2xl border border-border bg-card/30 p-4">
          {messages.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Ask something across your memory — e.g. "what did we decide about the database?" — or ask it to organise:
              tag, move, summarise or archive.
            </p>
          )}
          {messages.map((m) => (
            <div key={m.id} className={m.role === "user" ? "flex justify-end" : ""}>
              <div
                className={
                  m.role === "user"
                    ? "max-w-[85%] rounded-2xl bg-primary/15 px-3 py-2 text-sm"
                    : "max-w-full text-sm"
                }
              >
                {m.kind === "plan" && m.planId ? (
                  <>
                    <p className="mb-2 text-muted-foreground">I've proposed a plan. Nothing runs until you approve it:</p>
                    <PlanMessage planId={m.planId} onChanged={() => { loadSide(); onPlansChanged(); }} />
                  </>
                ) : (
                  <>
                    <p className="whitespace-pre-wrap">{m.content}</p>
                    {m.kind === "ask" && <p className="mt-1 text-xs text-muted-foreground">Reply below to answer.</p>}
                    <Citations citations={m.citations} onOpen={onOpenProject} />
                  </>
                )}
              </div>
            </div>
          ))}
          {busy && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
              {status ?? "Thinking…"}
            </p>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div ref={endRef} />
        </div>

        <div className="mt-3 flex items-end gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder="Ask across your projects…"
            rows={2}
            disabled={busy}
          />
          <Button onClick={() => void send()} disabled={busy || !input.trim()} size="icon" aria-label="Send">
            <Send className="size-4" />
          </Button>
        </div>
      </div>

      {/* State: tasks + past conversations */}
      <aside className="min-h-0 space-y-4 overflow-y-auto">
        <section>
          <h3 className="mb-2 text-sm font-medium">Active tasks</h3>
          {tasks.active.length === 0 && <p className="text-xs text-muted-foreground">Nothing running.</p>}
          <ul className="space-y-2">
            {tasks.active.map((t) => (
              <li key={t.id} className="rounded-lg border border-border bg-card/40 p-2.5 text-xs">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium">{t.title}</span>
                  <Badge variant={STATUS_VARIANT[t.status]}>{t.status.replace("_", " ")}</Badge>
                </div>
                {t.currentStep && <p className="mt-1 text-muted-foreground">{t.currentStep}</p>}
                {t.status === "awaiting_approval" && <p className="mt-1 text-muted-foreground">Approve or reject the plan in the chat or the Plans page.</p>}
                {(t.status === "awaiting_approval" || t.status === "planning") && (
                  <Button size="sm" variant="ghost" className="mt-1 h-6 gap-1 px-1.5" onClick={() => void taskAction(() => api.cancelTask(t.id))}>
                    <X className="size-3" /> Cancel
                  </Button>
                )}
                {t.status === "running" && (
                  <Button size="sm" variant="ghost" className="mt-1 h-6 gap-1 px-1.5" title="Use if it looks stuck after a restart" onClick={() => void taskAction(() => api.resumeTask(t.id))}>
                    <RotateCw className="size-3" /> Resume
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h3 className="mb-2 text-sm font-medium">Recent</h3>
          {tasks.recent.length === 0 && <p className="text-xs text-muted-foreground">No finished tasks yet.</p>}
          <ul className="space-y-1.5">
            {tasks.recent.map((t) => (
              <li key={t.id} className="flex items-start justify-between gap-2 text-xs">
                <span className="truncate text-muted-foreground" title={t.goal}>{t.title}</span>
                <span className="flex shrink-0 items-center gap-1">
                  <Badge variant={STATUS_VARIANT[t.status]}>{t.status.replace("_", " ")}</Badge>
                  {t.status === "failed" && t.planId && (
                    <Button size="icon" variant="ghost" className="size-5" title="Retry failed actions" onClick={() => void taskAction(() => api.resumeTask(t.id))}>
                      <RotateCw className="size-3" />
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h3 className="mb-2 text-sm font-medium">Conversations</h3>
          <ul className="space-y-1">
            {conversations.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => void openConversation(c.id)}
                  className={`w-full truncate rounded-md px-2 py-1 text-left text-xs transition-colors hover:bg-muted ${c.id === conversationId ? "bg-muted font-medium" : "text-muted-foreground"}`}
                >
                  {c.title}
                </button>
              </li>
            ))}
          </ul>
        </section>
      </aside>
    </div>
  );
}

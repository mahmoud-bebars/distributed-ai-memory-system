import { useState, type FormEvent } from "react";
import { api, type ChatSource } from "@/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { renderMarkdown } from "@/lib/markdown";
import { TYPE_BADGE_VARIANT } from "@/lib/memory";

interface Message {
  role: "user" | "assistant";
  text: string;
  sources?: ChatSource[];
}

export function ChatPanel({ slug, entryCount }: { slug: string; entryCount: number }) {
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
      const { answer, sources } = await api.askChat(slug, trimmed);
      setMessages((prev) => [...prev, { role: "assistant", text: answer, sources }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <ScrollArea className="min-h-0 flex-1 rounded-md border">
        <div className="flex flex-col gap-3 p-4">
          {messages.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Ask this project's memory something to get started.
            </p>
          )}
          {messages.map((m, i) => (
            <div key={i} className={m.role === "user" ? "text-right" : "text-left"}>
              <div
                className={`inline-block max-w-[85%] rounded-lg px-3 py-2 text-left text-sm ${
                  m.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-foreground"
                }`}
              >
                {m.role === "assistant" ? renderMarkdown(m.text) : m.text}
              </div>
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
            </div>
          ))}
          {loading && (
            <p className="text-sm text-muted-foreground">
              {entryCount > 0
                ? `Reading ${entryCount} memory ${entryCount === 1 ? "entry" : "entries"}…`
                : "Thinking…"}
            </p>
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

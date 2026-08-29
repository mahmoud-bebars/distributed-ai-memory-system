import { useState } from "react";
import { api } from "../api";

interface Message {
  role: "user" | "assistant";
  text: string;
}

export function ChatPanel({ slug }: { slug: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = question.trim();
    if (!trimmed || loading) return;

    setMessages((prev) => [...prev, { role: "user", text: trimmed }]);
    setQuestion("");
    setLoading(true);
    setError(null);

    try {
      const { answer } = await api.askChat(slug, trimmed);
      setMessages((prev) => [...prev, { role: "assistant", text: answer }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto space-y-3 mb-3">
        {messages.map((m, i) => (
          <div
            key={i}
            className={m.role === "user" ? "text-right" : "text-left"}
          >
            <span
              className={`inline-block px-3 py-2 rounded-lg text-sm ${
                m.role === "user" ? "bg-indigo-600 text-white" : "bg-gray-100 text-gray-900"
              }`}
            >
              {m.text}
            </span>
          </div>
        ))}
        {loading && <p className="text-sm text-gray-400">Thinking…</p>}
        {error && <p className="text-sm text-red-500">{error}</p>}
      </div>
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask this project's memory something…"
          className="flex-1 border rounded px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={loading}
          className="bg-indigo-600 text-white px-4 py-2 rounded text-sm disabled:opacity-50"
        >
          Ask
        </button>
      </form>
    </div>
  );
}

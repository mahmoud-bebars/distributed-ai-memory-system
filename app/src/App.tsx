import { useEffect, useState } from "react";
import { api, type MemoryEntry, type Project } from "./api";
import { ChatPanel } from "./components/ChatPanel";
import { MemoryGraph } from "./components/MemoryGraph";
import { ProjectList } from "./components/ProjectList";

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [entries, setEntries] = useState<MemoryEntry[]>([]);

  useEffect(() => {
    api.listProjects().then(setProjects).catch(() => setProjects([]));
  }, []);

  useEffect(() => {
    if (!selected) return;
    api.getMemory(selected).then(setEntries).catch(() => setEntries([]));
  }, [selected]);

  return (
    <div className="max-w-5xl mx-auto p-6">
      <h1 className="text-xl font-medium mb-4">Distributed AI Memory System</h1>

      {!selected ? (
        <ProjectList projects={projects} onSelect={setSelected} />
      ) : (
        <div>
          <button onClick={() => setSelected(null)} className="text-sm text-indigo-600 mb-4">
            ← back to projects
          </button>
          <div className="grid grid-cols-2 gap-6" style={{ height: "60vh" }}>
            <MemoryGraph entries={entries} />
            <ChatPanel slug={selected} />
          </div>
        </div>
      )}
    </div>
  );
}

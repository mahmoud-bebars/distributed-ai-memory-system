import { forceCenter, forceLink, forceManyBody, forceSimulation } from "d3-force";
import { useMemo } from "react";
import type { MemoryEntry } from "../api";

// Convention this visualization expects (adjust to match how your writers
// actually shape entries): entity content has a `name`; relation content
// has `source` and `target` matching entity names.
interface GraphNode {
  id: string;
  x: number;
  y: number;
}
interface GraphEdge {
  source: string;
  target: string;
  label?: string;
}

const WIDTH = 640;
const HEIGHT = 420;

function buildGraph(entries: MemoryEntry[]) {
  const entityNames = new Set(
    entries
      .filter((e) => e.type === "entity")
      .map((e) => String(e.content.name ?? e.id))
  );

  const edges: GraphEdge[] = entries
    .filter((e) => e.type === "relation")
    .map((e) => ({
      source: String(e.content.source ?? ""),
      target: String(e.content.target ?? ""),
      label: typeof e.content.label === "string" ? e.content.label : undefined,
    }))
    .filter((e) => entityNames.has(e.source) && entityNames.has(e.target));

  const nodes: GraphNode[] = Array.from(entityNames).map((id) => ({ id, x: 0, y: 0 }));

  const simulation = forceSimulation(nodes as any)
    .force("charge", forceManyBody().strength(-120))
    .force("center", forceCenter(WIDTH / 2, HEIGHT / 2))
    .force(
      "link",
      forceLink(edges as any)
        .id((d: any) => d.id)
        .distance(90)
    )
    .stop();

  for (let i = 0; i < 200; i++) simulation.tick();

  return { nodes, edges };
}

export function MemoryGraph({ entries }: { entries: MemoryEntry[] }) {
  const { nodes, edges } = useMemo(() => buildGraph(entries), [entries]);
  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  if (nodes.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        No entities recorded yet — this fills in once entries with type "entity" exist.
      </p>
    );
  }

  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full border rounded bg-white">
      {edges.map((edge, i) => {
        const a = nodeById.get(edge.source);
        const b = nodeById.get(edge.target);
        if (!a || !b) return null;
        return (
          <line
            key={i}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke="#c7c7c7"
            strokeWidth={1}
          />
        );
      })}
      {nodes.map((node) => (
        <g key={node.id}>
          <circle cx={node.x} cy={node.y} r={8} fill="#4f46e5" />
          <text x={node.x + 12} y={node.y + 4} fontSize={12} fill="#1f2937">
            {node.id}
          </text>
        </g>
      ))}
    </svg>
  );
}

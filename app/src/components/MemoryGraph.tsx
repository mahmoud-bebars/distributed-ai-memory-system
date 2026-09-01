import { drag } from "d3-drag";
import {
  forceCenter,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import { select } from "d3-selection";
import { type D3ZoomEvent, zoom, zoomIdentity } from "d3-zoom";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MemoryEntry } from "@/api";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";

interface GraphNode extends SimulationNodeDatum {
  id: string;
}
interface GraphLink extends SimulationLinkDatum<GraphNode> {
  label?: string;
}

const WIDTH = 800;
const HEIGHT = 520;

function entityName(entry: MemoryEntry): string {
  return String(entry.content.name ?? entry.id);
}

function buildGraph(entries: MemoryEntry[]) {
  const entityNames = new Set(entries.filter((e) => e.type === "entity").map(entityName));

  const links: GraphLink[] = entries
    .filter((e) => e.type === "relation")
    .map((e) => ({
      source: String(e.content.source ?? ""),
      target: String(e.content.target ?? ""),
      label: typeof e.content.label === "string" ? e.content.label : undefined,
    }))
    .filter((l) => entityNames.has(l.source as string) && entityNames.has(l.target as string));

  const nodes: GraphNode[] = Array.from(entityNames).map((id) => ({ id }));

  return { nodes, links };
}

/** Entries "about" a given entity: itself, relations touching it, and
 * observations that reference it (by `entity` field, or by mention). */
function relatedEntries(entries: MemoryEntry[], name: string): MemoryEntry[] {
  return entries.filter((e) => {
    if (e.type === "entity") return entityName(e) === name;
    if (e.type === "relation") return e.content.source === name || e.content.target === name;
    const field = e.content.entity ?? e.content.name ?? e.content.source;
    if (typeof field === "string") return field === name;
    return JSON.stringify(e.content).includes(name);
  });
}

export function MemoryGraph({ entries }: { entries: MemoryEntry[] }) {
  const { nodes, links } = useMemo(() => buildGraph(entries), [entries]);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const zoomGroupRef = useRef<SVGGElement | null>(null);
  const simulationRef = useRef<Simulation<GraphNode, GraphLink> | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const searchMatch = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return null;
    return nodes.find((n) => n.id.toLowerCase().includes(q)) ?? null;
  }, [search, nodes]);

  useEffect(() => {
    if (!svgRef.current || !zoomGroupRef.current || nodes.length === 0) return;

    const svg = select(svgRef.current);
    const zoomGroup = select(zoomGroupRef.current);

    const linkSelection = zoomGroup
      .select<SVGGElement>(".links")
      .selectAll<SVGLineElement, GraphLink>("line")
      .data(links)
      .join("line")
      .attr("stroke", "var(--color-muted-foreground)")
      .attr("stroke-opacity", 0.4)
      .attr("stroke-width", 1.5);

    const nodeGroup = zoomGroup
      .select<SVGGElement>(".nodes")
      .selectAll<SVGGElement, GraphNode>("g")
      .data(nodes, (d) => d.id)
      .join((enter) => {
        const g = enter.append("g").style("cursor", "pointer");
        g.append("circle").attr("r", 9);
        g.append("text")
          .attr("x", 13)
          .attr("y", 4)
          .attr("font-size", 12)
          .attr("fill", "var(--color-foreground)")
          .text((d) => d.id);
        return g;
      });

    nodeGroup
      .select("circle")
      .attr("fill", (d) => (d.id === selected ? "var(--color-destructive)" : "var(--color-primary)"))
      .attr("stroke", (d) =>
        searchMatch && d.id === searchMatch.id ? "var(--color-destructive)" : "none"
      )
      .attr("stroke-width", 3);

    nodeGroup.on("click", (_event, d) => setSelected(d.id));

    const simulation =
      simulationRef.current ??
      forceSimulation<GraphNode>()
        .force("charge", forceManyBody().strength(-160))
        .force("center", forceCenter(WIDTH / 2, HEIGHT / 2))
        .force("link", forceLink<GraphNode, GraphLink>().id((d) => d.id).distance(100));
    simulationRef.current = simulation;

    simulation.nodes(nodes);
    simulation.force<ReturnType<typeof forceLink<GraphNode, GraphLink>>>("link")?.links(links);
    simulation.alpha(0.6).restart();

    simulation.on("tick", () => {
      linkSelection
        .attr("x1", (d) => (d.source as GraphNode).x ?? 0)
        .attr("y1", (d) => (d.source as GraphNode).y ?? 0)
        .attr("x2", (d) => (d.target as GraphNode).x ?? 0)
        .attr("y2", (d) => (d.target as GraphNode).y ?? 0);

      nodeGroup.attr("transform", (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
    });

    const dragBehavior = drag<SVGGElement, GraphNode>()
      .on("start", (event, d) => {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on("drag", (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on("end", (event, d) => {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });
    nodeGroup.call(dragBehavior);

    const zoomBehavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 4])
      .on("zoom", (event: D3ZoomEvent<SVGSVGElement, unknown>) => {
        zoomGroup.attr("transform", event.transform.toString());
      });
    svg.call(zoomBehavior);

    if (searchMatch && searchMatch.x != null && searchMatch.y != null) {
      const transform = zoomIdentity
        .translate(WIDTH / 2, HEIGHT / 2)
        .scale(1.4)
        .translate(-searchMatch.x, -searchMatch.y);
      svg.call(zoomBehavior.transform, transform);
    }

    return () => {
      simulation.on("tick", null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, links, selected, searchMatch]);

  useEffect(() => {
    return () => {
      simulationRef.current?.stop();
    };
  }, []);

  const selectedEntries = selected ? relatedEntries(entries, selected) : [];

  if (nodes.length === 0) {
    return (
      <p className="p-4 text-sm text-muted-foreground">
        No entities recorded yet — this fills in once entries with type "entity" exist.
      </p>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center gap-3">
        <Input
          placeholder="Search entity by name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <div className="ml-auto flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="inline-block size-2.5 rounded-full bg-primary" /> entity
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-px w-4 bg-muted-foreground" /> relation
          </span>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden rounded-md border bg-card">
        <svg ref={svgRef} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-full w-full">
          <g ref={zoomGroupRef}>
            <g className="links" />
            <g className="nodes" />
          </g>
        </svg>
      </div>

      <Sheet open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{selected}</SheetTitle>
            <SheetDescription>
              All entries referencing this entity ({selectedEntries.length}).
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-3 overflow-auto px-4 pb-4">
            {selectedEntries.map((entry) => (
              <div key={entry.id} className="rounded-md border p-3">
                <Badge variant="outline" className="mb-2">
                  {entry.type}
                </Badge>
                <pre className="whitespace-pre-wrap break-all text-xs text-muted-foreground">
                  {JSON.stringify(entry.content, null, 2)}
                </pre>
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

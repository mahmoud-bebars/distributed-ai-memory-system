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
import { select, type Selection } from "d3-selection";
import { type D3ZoomEvent, zoom, type ZoomBehavior, zoomIdentity } from "d3-zoom";
import { Minus, Plus, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MemoryEntry } from "@/api";
import { CategoryBadge } from "@/components/CategoryBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  CATEGORY_COLORS,
  categoryOf,
  currentEntities,
  entityName,
  observationEntityName,
  observationText,
  relationLabel,
  type EntityCategory,
} from "@/lib/memory";

interface GraphNode extends SimulationNodeDatum {
  id: string;
  category: EntityCategory;
}
interface GraphLink extends SimulationLinkDatum<GraphNode> {
  label?: string;
}

const WIDTH = 800;
const HEIGHT = 520;
const NODE_RADIUS = 9;

function buildGraph(entries: MemoryEntry[]) {
  const current = currentEntities(entries);
  const categoryByName = new Map(current.map((e) => [entityName(e), categoryOf(e)]));
  const entityNames = new Set(categoryByName.keys());

  const links: GraphLink[] = entries
    .filter((e) => e.type === "relation")
    .map((e) => ({
      source: String(e.content.source ?? ""),
      target: String(e.content.target ?? ""),
      label: relationLabel(e),
    }))
    .filter((l) => entityNames.has(l.source as string) && entityNames.has(l.target as string));

  const nodes: GraphNode[] = Array.from(entityNames).map((id) => ({
    id,
    category: categoryByName.get(id) ?? "other",
  }));

  return { nodes, links };
}

interface RelationRef {
  label?: string;
  name: string;
}

interface EntityDetail {
  entity: MemoryEntry | null;
  observations: MemoryEntry[];
  outgoing: RelationRef[];
  incoming: RelationRef[];
}

function buildEntityDetail(entries: MemoryEntry[], name: string): EntityDetail {
  const entity = currentEntities(entries).find((e) => entityName(e) === name) ?? null;
  const observations = entries.filter(
    (e) => e.type === "observation" && observationEntityName(e) === name
  );
  const outgoing = entries
    .filter((e) => e.type === "relation" && e.content.source === name)
    .map((e) => ({ label: relationLabel(e), name: String(e.content.target ?? "") }));
  const incoming = entries
    .filter((e) => e.type === "relation" && e.content.target === name)
    .map((e) => ({ label: relationLabel(e), name: String(e.content.source ?? "") }));
  return { entity, observations, outgoing, incoming };
}

export function MemoryGraph({ entries }: { entries: MemoryEntry[] }) {
  const { nodes, links } = useMemo(() => buildGraph(entries), [entries]);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const zoomGroupRef = useRef<SVGGElement | null>(null);
  const simulationRef = useRef<Simulation<GraphNode, GraphLink> | null>(null);
  const zoomBehaviorRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const searchMatch = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return null;
    return nodes.find((n) => n.id.toLowerCase().includes(q)) ?? null;
  }, [search, nodes]);

  const legend = useMemo(() => {
    const present = new Set(nodes.map((n) => n.category));
    return Array.from(present).sort();
  }, [nodes]);

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
      .attr("stroke-opacity", 0.5)
      .attr("stroke-width", 1.5)
      .attr("marker-end", "url(#dams-arrow)");

    const nodeGroup = zoomGroup
      .select<SVGGElement>(".nodes")
      .selectAll<SVGGElement, GraphNode>("g")
      .data(nodes, (d) => d.id)
      .join((enter) => {
        const g = enter.append("g").style("cursor", "pointer");
        g.append("circle").attr("r", NODE_RADIUS);
        g.append("text")
          .attr("x", NODE_RADIUS + 4)
          .attr("y", 4)
          .attr("font-size", 12)
          .attr("fill", "var(--color-foreground)")
          .text((d) => d.id);
        return g;
      });

    nodeGroup
      .select("circle")
      .attr("fill", (d) => CATEGORY_COLORS[d.category])
      .attr("stroke", (d) => {
        if (d.id === selected) return "var(--color-foreground)";
        if (searchMatch && d.id === searchMatch.id) return "var(--color-foreground)";
        return "none";
      })
      .attr("stroke-width", (d) => (d.id === selected ? 3 : searchMatch?.id === d.id ? 2 : 0));

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
        .attr("x2", (d) => {
          const s = d.source as GraphNode;
          const t = d.target as GraphNode;
          const dx = (t.x ?? 0) - (s.x ?? 0);
          const dy = (t.y ?? 0) - (s.y ?? 0);
          const len = Math.hypot(dx, dy) || 1;
          return (t.x ?? 0) - (dx / len) * (NODE_RADIUS + 6);
        })
        .attr("y2", (d) => {
          const s = d.source as GraphNode;
          const t = d.target as GraphNode;
          const dx = (t.x ?? 0) - (s.x ?? 0);
          const dy = (t.y ?? 0) - (s.y ?? 0);
          const len = Math.hypot(dx, dy) || 1;
          return (t.y ?? 0) - (dy / len) * (NODE_RADIUS + 6);
        });

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
    zoomBehaviorRef.current = zoomBehavior;
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

  function withZoom(fn: (svg: Selection<SVGSVGElement, unknown, null, undefined>, zb: ZoomBehavior<SVGSVGElement, unknown>) => void) {
    if (!svgRef.current || !zoomBehaviorRef.current) return;
    fn(select(svgRef.current), zoomBehaviorRef.current);
  }

  const detail = selected ? buildEntityDetail(entries, selected) : null;

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
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            title="Zoom in"
            onClick={() => withZoom((svg, zb) => svg.call(zb.scaleBy, 1.3))}
          >
            <Plus className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            title="Zoom out"
            onClick={() => withZoom((svg, zb) => svg.call(zb.scaleBy, 1 / 1.3))}
          >
            <Minus className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            title="Reset view"
            onClick={() => withZoom((svg, zb) => svg.call(zb.transform, zoomIdentity))}
          >
            <RotateCcw className="size-4" />
          </Button>
        </div>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden rounded-md border bg-card">
        <svg ref={svgRef} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-full w-full">
          <defs>
            <marker
              id="dams-arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M0,0L10,5L0,10z" fill="var(--color-muted-foreground)" />
            </marker>
          </defs>
          <g ref={zoomGroupRef}>
            <g className="links" />
            <g className="nodes" />
          </g>
        </svg>

        <div className="absolute bottom-3 left-3 rounded-md border bg-card/95 p-2.5 text-xs shadow-sm backdrop-blur">
          <p className="mb-1.5 font-medium text-muted-foreground">Category</p>
          <div className="flex flex-col gap-1">
            {legend.map((category) => (
              <span key={category} className="flex items-center gap-1.5">
                <span
                  className="inline-block size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: CATEGORY_COLORS[category] }}
                />
                {category}
              </span>
            ))}
            <span className="mt-1 flex items-center gap-1.5 border-t pt-1 text-muted-foreground">
              <span className="inline-block h-px w-4 bg-muted-foreground" /> relation
            </span>
          </div>
        </div>
      </div>

      <Sheet open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{selected}</SheetTitle>
            <SheetDescription asChild>
              <div className="flex items-center gap-2">
                <CategoryBadge category={detail?.entity ? categoryOf(detail.entity) : "other"} />
              </div>
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-5 px-4 pb-4">
            <section>
              <h3 className="mb-2 text-sm font-medium">Observations</h3>
              {detail && detail.observations.length > 0 ? (
                <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
                  {detail.observations.map((entry) => (
                    <li key={entry.id}>{observationText(entry)}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No observations recorded.</p>
              )}
            </section>

            <section>
              <h3 className="mb-2 text-sm font-medium">Relations</h3>
              {detail && detail.outgoing.length + detail.incoming.length > 0 ? (
                <ul className="space-y-1.5 text-sm text-muted-foreground">
                  {detail.outgoing.map((rel, i) => (
                    <li key={`out-${i}`}>
                      → {rel.label ?? "relates to"} → {rel.name}
                    </li>
                  ))}
                  {detail.incoming.map((rel, i) => (
                    <li key={`in-${i}`}>
                      ← {rel.label ?? "relates to"} ← {rel.name}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No relations recorded.</p>
              )}
            </section>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

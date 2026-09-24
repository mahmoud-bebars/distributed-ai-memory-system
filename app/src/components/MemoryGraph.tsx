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
import { LayoutGrid, List, Maximize2, Minus, Network, Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
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
import { cn } from "@/lib/utils";
import {
  CATEGORY_ICONS,
  categoryColor,
  categoryOf,
  currentEntities,
  ENTITY_CATEGORIES,
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
const NODE_RADIUS = 15;

// Precomputed once: raw SVG markup for each category's lucide icon, white on
// transparent, embedded into each node via <foreignObject> — the graph is
// d3-driven (imperative DOM), so nodes aren't React elements and can't
// render <Icon /> directly.
const ICON_MARKUP: Record<EntityCategory, string> = Object.fromEntries(
  ENTITY_CATEGORIES.map((category) => {
    const Icon = CATEGORY_ICONS[category];
    return [category, renderToStaticMarkup(<Icon color="white" strokeWidth={2.25} size={16} />)];
  })
) as Record<EntityCategory, string>;

type ViewMode = "network" | "grid" | "list";

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

/** An external request to select+pan to a node — e.g. clicking a chat
 *  citation. `nonce` lets the same id be requested twice in a row and still
 *  re-trigger the pan (an id alone wouldn't change and the effect wouldn't rerun). */
export interface GraphFocusRequest {
  id: string;
  nonce: number;
}

function EntityChip({
  id,
  category,
  onClick,
}: {
  id: string;
  category: EntityCategory;
  onClick: () => void;
}) {
  const color = categoryColor(category);
  const Icon = CATEGORY_ICONS[category];
  return (
    <button
      type="button"
      onClick={onClick}
      className="glow-hover flex items-center gap-2.5 rounded-xl border border-border bg-card p-2.5 text-left"
      style={{ "--glow-color": color } as React.CSSProperties}
    >
      <span
        className="flex size-8 shrink-0 items-center justify-center rounded-lg"
        style={{ backgroundColor: color }}
      >
        <Icon className="size-4 text-white" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{id}</span>
        <span className="block text-xs text-muted-foreground capitalize">{category}</span>
      </span>
    </button>
  );
}

export function MemoryGraph({
  entries,
  focusRequest,
}: {
  entries: MemoryEntry[];
  focusRequest?: GraphFocusRequest | null;
}) {
  const { nodes, links } = useMemo(() => buildGraph(entries), [entries]);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const zoomGroupRef = useRef<SVGGElement | null>(null);
  const simulationRef = useRef<Simulation<GraphNode, GraphLink> | null>(null);
  const zoomBehaviorRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [mode, setMode] = useState<ViewMode>("network");
  const [zoomPct, setZoomPct] = useState(100);

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
    if (mode !== "network" || !svgRef.current || !zoomGroupRef.current || nodes.length === 0) return;

    const svg = select(svgRef.current);
    const zoomGroup = select(zoomGroupRef.current);

    const linkSelection = zoomGroup
      .select<SVGGElement>(".links")
      .selectAll<SVGPathElement, GraphLink>("path")
      .data(links)
      .join("path")
      .attr("fill", "none")
      .attr("stroke", "url(#dams-link-fade)")
      .attr("stroke-width", 1.5)
      .attr("marker-end", "url(#dams-arrow)");

    const nodeGroup = zoomGroup
      .select<SVGGElement>(".nodes")
      .selectAll<SVGGElement, GraphNode>("g")
      .data(nodes, (d) => d.id)
      .join((enter) => {
        const g = enter.append("g").attr("class", "dams-node").style("cursor", "pointer");
        g.append("circle").attr("class", "dams-node-ring").attr("r", NODE_RADIUS + 4).attr("fill", "none");
        g.append("circle").attr("class", "dams-node-circle").attr("r", NODE_RADIUS);
        g.append("foreignObject")
          .attr("x", -8)
          .attr("y", -8)
          .attr("width", 16)
          .attr("height", 16)
          .style("pointer-events", "none")
          .html((d) => ICON_MARKUP[d.category]);
        g.append("text")
          .attr("class", "dams-node-label")
          .attr("x", NODE_RADIUS + 6)
          .attr("y", 4)
          .attr("font-size", 12)
          .attr("fill", "var(--color-foreground)")
          .text((d) => d.id);
        return g;
      });

    nodeGroup
      .attr("data-selected", (d) => d.id === selected)
      .attr("data-match", (d) => searchMatch?.id === d.id)
      .style("--node-color", (d) => categoryColor(d.category));

    nodeGroup.select(".dams-node-circle").attr("fill", (d) => categoryColor(d.category));
    nodeGroup
      .select(".dams-node-ring")
      .attr("stroke", (d) => (d.id === selected || searchMatch?.id === d.id ? "var(--color-foreground)" : "transparent"))
      .attr("stroke-width", 2);

    nodeGroup.on("click", (_event, d) => setSelected(d.id));

    const simulation =
      simulationRef.current ??
      forceSimulation<GraphNode>()
        .force("charge", forceManyBody().strength(-220))
        .force("center", forceCenter(WIDTH / 2, HEIGHT / 2))
        .force("link", forceLink<GraphNode, GraphLink>().id((d) => d.id).distance(115));
    simulationRef.current = simulation;

    simulation.nodes(nodes);
    simulation.force<ReturnType<typeof forceLink<GraphNode, GraphLink>>>("link")?.links(links);
    simulation.alpha(0.6).restart();

    simulation.on("tick", () => {
      linkSelection.attr("d", (d) => {
        const s = d.source as GraphNode;
        const t = d.target as GraphNode;
        const sx = s.x ?? 0;
        const sy = s.y ?? 0;
        let tx = t.x ?? 0;
        let ty = t.y ?? 0;
        const dx = tx - sx;
        const dy = ty - sy;
        const len = Math.hypot(dx, dy) || 1;
        // Pull the arrowhead back off the node circle, then bow the path
        // gently outward from the straight line for a soft curve.
        tx -= (dx / len) * (NODE_RADIUS + 6);
        ty -= (dy / len) * (NODE_RADIUS + 6);
        const mx = (sx + tx) / 2 - dy * 0.12;
        const my = (sy + ty) / 2 + dx * 0.12;
        return `M${sx},${sy} Q${mx},${my} ${tx},${ty}`;
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
        setZoomPct(Math.round(event.transform.k * 100));
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
  }, [nodes, links, selected, searchMatch, mode]);

  useEffect(() => {
    return () => {
      simulationRef.current?.stop();
    };
  }, []);

  // The <svg> unmounts whenever `mode` leaves "network" (grid/list render
  // plain HTML instead), so a fresh one — at identity transform — is
  // mounted each time it comes back. Resync the displayed percentage only
  // on that transition, not on every selection change (which also reruns
  // the effect above but leaves the existing zoom transform untouched).
  const prevModeRef = useRef<ViewMode>(mode);
  useEffect(() => {
    if (mode === "network" && prevModeRef.current !== "network") setZoomPct(100);
    prevModeRef.current = mode;
  }, [mode]);

  // An external jump request (e.g. a chat citation click) — select the node
  // and, if it currently has simulation coordinates, pan/zoom to it exactly
  // like a search match does.
  useEffect(() => {
    if (!focusRequest) return;
    setMode("network");
    setSelected(focusRequest.id);
    const node = nodes.find((n) => n.id === focusRequest.id);
    if (node && node.x != null && node.y != null && svgRef.current && zoomBehaviorRef.current) {
      const transform = zoomIdentity
        .translate(WIDTH / 2, HEIGHT / 2)
        .scale(1.4)
        .translate(-node.x, -node.y);
      select(svgRef.current).call(zoomBehaviorRef.current.transform, transform);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest?.nonce]);

  function withZoom(fn: (svg: Selection<SVGSVGElement, unknown, null, undefined>, zb: ZoomBehavior<SVGSVGElement, unknown>) => void) {
    if (!svgRef.current || !zoomBehaviorRef.current) return;
    fn(select(svgRef.current), zoomBehaviorRef.current);
  }

  function fitToScreen() {
    const withCoords = nodes.filter((n) => n.x != null && n.y != null);
    if (withCoords.length === 0) {
      withZoom((svg, zb) => svg.call(zb.transform, zoomIdentity));
      return;
    }
    const xs = withCoords.map((n) => n.x as number);
    const ys = withCoords.map((n) => n.y as number);
    const minX = Math.min(...xs) - NODE_RADIUS - 30;
    const maxX = Math.max(...xs) + NODE_RADIUS + 30;
    const minY = Math.min(...ys) - NODE_RADIUS - 30;
    const maxY = Math.max(...ys) + NODE_RADIUS + 30;
    const w = Math.max(maxX - minX, 1);
    const h = Math.max(maxY - minY, 1);
    const scale = Math.min(4, Math.max(0.3, Math.min(WIDTH / w, HEIGHT / h)));
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const transform = zoomIdentity.translate(WIDTH / 2, HEIGHT / 2).scale(scale).translate(-cx, -cy);
    withZoom((svg, zb) => svg.call(zb.transform, transform));
  }

  const detail = selected ? buildEntityDetail(entries, selected) : null;

  if (nodes.length === 0) {
    return (
      <p className="p-4 text-sm text-muted-foreground">
        No entities recorded yet — this fills in once entries with type "entity" exist.
      </p>
    );
  }

  const viewModes: { key: ViewMode; icon: typeof Network; title: string }[] = [
    { key: "network", icon: Network, title: "Graph layout" },
    { key: "grid", icon: LayoutGrid, title: "Grid layout" },
    { key: "list", icon: List, title: "Compact list" },
  ];

  return (
    <div className="flex h-full flex-col gap-3">
      <style>{`
        .dams-node-circle { transition: filter 150ms ease, r 150ms ease; }
        .dams-node:hover .dams-node-circle,
        .dams-node[data-selected="true"] .dams-node-circle,
        .dams-node[data-match="true"] .dams-node-circle {
          filter: drop-shadow(0 0 8px var(--node-color));
        }
        .dams-node-ring { transition: stroke-opacity 150ms ease; }
        .dams-node-label { paint-order: stroke; stroke: var(--color-background); stroke-width: 3px; stroke-linejoin: round; }
      `}</style>
      <div className="flex items-center gap-3">
        <Input
          placeholder="Search entity by name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-card">
        {mode === "network" && (
          <svg ref={svgRef} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-full w-full">
            <defs>
              <linearGradient id="dams-link-fade">
                <stop offset="0%" stopColor="var(--color-muted-foreground)" stopOpacity={0.7} />
                <stop offset="50%" stopColor="var(--color-muted-foreground)" stopOpacity={0.15} />
                <stop offset="100%" stopColor="var(--color-muted-foreground)" stopOpacity={0.7} />
              </linearGradient>
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
        )}

        {mode === "grid" && (
          <div className="grid h-full grid-cols-2 gap-2 overflow-y-auto p-3 sm:grid-cols-3 lg:grid-cols-4">
            {nodes.map((n) => (
              <EntityChip key={n.id} id={n.id} category={n.category} onClick={() => setSelected(n.id)} />
            ))}
          </div>
        )}

        {mode === "list" && (
          <div className="flex h-full flex-col gap-1.5 overflow-y-auto p-3">
            {nodes.map((n) => (
              <EntityChip key={n.id} id={n.id} category={n.category} onClick={() => setSelected(n.id)} />
            ))}
          </div>
        )}

        <div className="absolute bottom-3 left-3 flex items-center gap-1.5 rounded-xl border border-border bg-popover/95 p-1.5 shadow-sm backdrop-blur">
          {viewModes.map(({ key, icon: Icon, title }) => (
            <Button
              key={key}
              variant="ghost"
              size="icon-sm"
              title={title}
              aria-pressed={mode === key}
              className={cn(mode === key && "bg-accent text-accent-foreground")}
              onClick={() => setMode(key)}
            >
              <Icon className="size-4" />
            </Button>
          ))}
          {mode === "network" && (
            <>
              <span className="mx-0.5 h-5 w-px bg-border" />
              <Button variant="ghost" size="icon-sm" title="Zoom out" onClick={() => withZoom((svg, zb) => svg.call(zb.scaleBy, 1 / 1.3))}>
                <Minus className="size-4" />
              </Button>
              <span className="w-10 text-center text-xs tabular-nums text-muted-foreground">{zoomPct}%</span>
              <Button variant="ghost" size="icon-sm" title="Zoom in" onClick={() => withZoom((svg, zb) => svg.call(zb.scaleBy, 1.3))}>
                <Plus className="size-4" />
              </Button>
              <Button variant="ghost" size="icon-sm" title="Fit to screen" onClick={fitToScreen}>
                <Maximize2 className="size-4" />
              </Button>
            </>
          )}
        </div>

        {mode === "network" && (
          <div className="absolute bottom-3 right-3 rounded-xl border border-border bg-popover/95 p-2.5 text-xs shadow-sm backdrop-blur">
            <p className="mb-1.5 font-medium text-muted-foreground">Category</p>
            <div className="flex flex-col gap-1">
              {legend.map((category) => {
                const Icon = CATEGORY_ICONS[category];
                return (
                  <span key={category} className="flex items-center gap-1.5">
                    <Icon className="size-3" style={{ color: categoryColor(category) }} />
                    {category}
                  </span>
                );
              })}
              <span className="mt-1 flex items-center gap-1.5 border-t border-border pt-1 text-muted-foreground">
                <span className="inline-block h-px w-4 bg-muted-foreground" /> relation
              </span>
            </div>
          </div>
        )}
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

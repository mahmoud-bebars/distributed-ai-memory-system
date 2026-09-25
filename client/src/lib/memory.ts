import {
  Building2,
  CalendarDays,
  CircleDot,
  Cpu,
  FlaskConical,
  FolderKanban,
  type LucideIcon,
  Lightbulb,
  Package,
  Sparkles,
  User,
} from "lucide-react";
import type { MemoryEntry } from "@/api";
import { accentVar, type AccentHue } from "@/lib/palette";

// Mirrors src/modules/projects/schema.ts's entityCategorySchema. Kept as a
// plain duplicate rather than a shared import — the frontend doesn't build
// against the Worker's source tree (see api.ts's own MemoryEntry copy).
export const ENTITY_CATEGORIES = [
  "concept",
  "event",
  "feature",
  "organization",
  "person",
  "product",
  "project",
  "research",
  "technology",
  "other",
] as const;

export type EntityCategory = (typeof ENTITY_CATEGORIES)[number];

export const DEFAULT_ENTITY_CATEGORY: EntityCategory = "other";

// Each entity category maps to one of the theme's semantic accent hues
// (see docs/DESIGN.md) plus a representative icon, used by the graph nodes,
// category badges, and legends. "other" deliberately falls back to the
// neutral muted-foreground tone rather than an accent, so uncategorized
// entities (common — see EntityCategory's docs) don't visually compete
// with intentionally-categorized ones.
export const CATEGORY_HUES: Record<EntityCategory, AccentHue | "neutral"> = {
  concept: "violet",
  event: "amber",
  feature: "teal",
  organization: "rose",
  person: "cyan",
  product: "blue",
  project: "green",
  research: "fuchsia",
  technology: "indigo",
  other: "neutral",
};

export const CATEGORY_ICONS: Record<EntityCategory, LucideIcon> = {
  concept: Lightbulb,
  event: CalendarDays,
  feature: Sparkles,
  organization: Building2,
  person: User,
  product: Package,
  project: FolderKanban,
  research: FlaskConical,
  technology: Cpu,
  other: CircleDot,
};

export function categoryColor(category: EntityCategory): string {
  const hue = CATEGORY_HUES[category];
  return hue === "neutral" ? "var(--muted-foreground)" : accentVar(hue);
}

export function entityName(entry: MemoryEntry): string {
  return String(entry.content.name ?? entry.id);
}

export function categoryOf(entry: MemoryEntry): EntityCategory {
  const value = entry.content.category;
  return typeof value === "string" && (ENTITY_CATEGORIES as readonly string[]).includes(value)
    ? (value as EntityCategory)
    : DEFAULT_ENTITY_CATEGORY;
}

/** The entity name an observation is about, per the `{ text, entity? }`
 *  convention. Absent means it's a general project note, not an error. */
export function observationEntityName(entry: MemoryEntry): string | undefined {
  const value = entry.content.entity;
  return typeof value === "string" ? value : undefined;
}

/** Plain-language observation text, falling back to a JSON preview for
 *  entries written before the `{ text, entity? }` convention existed. */
export function observationText(entry: MemoryEntry): string {
  const text = entry.content.text;
  if (typeof text === "string") return text;
  return JSON.stringify(entry.content);
}

export function relationLabel(entry: MemoryEntry): string | undefined {
  const label = entry.content.label;
  return typeof label === "string" ? label : undefined;
}

export const TYPE_BADGE_VARIANT: Record<MemoryEntry["type"], "default" | "secondary" | "outline"> = {
  entity: "default",
  relation: "secondary",
  observation: "outline",
};

/** Given a chat citation (see ChatSource), finds the entity name it's about
 *  — the entity itself, the entity an observation is attached to, or the
 *  source side of a relation — so a citation click can jump the graph
 *  straight to the relevant node. Returns null when the entry no longer
 *  exists or the citation doesn't resolve to any entity. */
export function resolveSourceEntity(
  entries: MemoryEntry[],
  source: { id: string; type: MemoryEntry["type"] }
): string | null {
  const entry = entries.find((e) => e.id === source.id);
  if (!entry) return null;
  if (entry.type === "entity") return entityName(entry);
  if (entry.type === "observation") return observationEntityName(entry) ?? null;
  if (entry.type === "relation") {
    const value = entry.content.source;
    return typeof value === "string" ? value : null;
  }
  return null;
}

/** Last-write-wins projection of entities: dedupe by `content.name`,
 *  keeping the last occurrence in file order as current. Mirrors
 *  ProjectsService.currentEntities on the backend — this is a read-side
 *  view, the underlying log (and the raw export) still has every version. */
export function currentEntities(entries: MemoryEntry[]): MemoryEntry[] {
  const byName = new Map<string, MemoryEntry>();
  for (const entry of entries) {
    if (entry.type !== "entity") continue;
    byName.set(entityName(entry), entry);
  }
  return Array.from(byName.values());
}

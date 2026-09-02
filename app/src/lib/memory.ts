import type { MemoryEntry } from "@/api";

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

// Tableau10, assigned in a fixed order so a category always gets the same
// color across sessions and views.
export const CATEGORY_COLORS: Record<EntityCategory, string> = {
  concept: "#4E79A7",
  event: "#F28E2B",
  feature: "#59A14F",
  organization: "#B07AA1",
  person: "#E15759",
  product: "#EDC948",
  project: "#76B7B2",
  research: "#9C755F",
  technology: "#FF9DA7",
  other: "#BAB0AC",
};

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

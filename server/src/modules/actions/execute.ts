import type { Bindings } from "../../lib/bindings";
import type { MemoryEntry } from "../projects/schema";
import { ProjectsService } from "../projects/service";
import type { Action } from "./schema";

export interface ActionOutcome {
  result: Record<string, unknown>;
  /** How to undo it. Recorded in the audit trail; an undo executor isn't
   *  built yet, so this is informational for now. */
  inverse: Record<string, unknown> | null;
}

// Deterministic entry ids derived from the action id are what make every
// action idempotent: a retry (Workflow step retry, re-run after a partial
// failure) finds the entry already in the log and skips the append instead of
// duplicating it.
async function appendOnce(projects: ProjectsService, slug: string, entry: MemoryEntry): Promise<boolean> {
  const existing = await projects.readMemory(slug);
  if (existing.some((e) => e.id === entry.id)) return false;
  await projects.appendMemory(slug, entry);
  return true;
}

const now = () => new Date().toISOString();

async function requireProject(projects: ProjectsService, slug: string) {
  const project = await projects.get(slug);
  if (!project) throw new Error(`Unknown project: ${slug}`);
  return project;
}

/** Runs ONE already-approved action. This is the only code that mutates on
 *  behalf of a plan, reachable only through ActionsService.executePlan /
 *  ActionsWorkflow after an admin approval. Everything is either an append to
 *  a memory log or a flag/field update on the project registry — history is
 *  never rewritten and nothing is deleted. */
export async function executeAction(env: Bindings, actionId: string, action: Action): Promise<ActionOutcome> {
  const projects = new ProjectsService(env);

  switch (action.type) {
    case "create_project": {
      // Idempotent by the caller's per-action status; a slug that appeared
      // since approval is a real conflict and fails loudly.
      const project = await projects.create({
        slug: action.slug,
        title: action.title,
        summary: action.summary,
        tags: action.tags,
        includeInGlobalSearch: action.includeInGlobalSearch,
      });
      return { result: { slug: project.slug }, inverse: { type: "archive_project", slug: project.slug } };
    }

    case "update_project": {
      const before = await requireProject(projects, action.slug);
      await projects.update(action.slug, {
        title: action.title ?? before.title,
        summary: action.summary !== undefined ? action.summary || null : before.summary,
        tags: action.tags ?? (JSON.parse(before.tags) as string[]),
        includeInGlobalSearch: action.includeInGlobalSearch,
        archived: action.archived,
      });
      return {
        result: { slug: action.slug },
        inverse: {
          type: "update_project",
          slug: action.slug,
          title: before.title,
          summary: before.summary ?? "",
          tags: JSON.parse(before.tags) as string[],
          includeInGlobalSearch: before.includeInGlobalSearch,
          archived: before.archived,
        },
      };
    }

    case "archive_project": {
      const before = await requireProject(projects, action.slug);
      await projects.update(action.slug, {
        title: before.title,
        summary: before.summary,
        tags: JSON.parse(before.tags) as string[],
        archived: true,
      });
      return {
        result: { slug: action.slug },
        inverse: { type: "update_project", slug: action.slug, archived: before.archived },
      };
    }

    case "tag_entries": {
      await requireProject(projects, action.slug);
      const known = new Set((await projects.readMemory(action.slug)).map((e) => e.id));
      const missing = action.entryIds.filter((id) => !known.has(id));
      if (missing.length > 0) throw new Error(`Entries not found in ${action.slug}: ${missing.join(", ")}`);

      const entryId = actionId;
      await appendOnce(projects, action.slug, {
        id: entryId,
        type: "observation",
        content: {
          kind: "annotation",
          text: `Tagged ${action.entryIds.length} ${action.entryIds.length === 1 ? "entry" : "entries"}: ${action.tags.join(", ")}`,
          tags: action.tags,
          entryIds: action.entryIds,
        },
        created_at: now(),
      });
      return {
        result: { annotationId: entryId },
        inverse: { type: "untag_entries", slug: action.slug, entryIds: action.entryIds, tags: action.tags, annotationId: entryId },
      };
    }

    case "move_entries": {
      await requireProject(projects, action.sourceSlug);
      await requireProject(projects, action.targetSlug);
      const sourceEntries = await projects.readMemory(action.sourceSlug);
      const byId = new Map(sourceEntries.map((e) => [e.id, e]));
      const missing = action.entryIds.filter((id) => !byId.has(id));
      if (missing.length > 0) throw new Error(`Entries not found in ${action.sourceSlug}: ${missing.join(", ")}`);

      // 1) Copy into the target with provenance...
      const targetEntryIds: string[] = [];
      for (const id of action.entryIds) {
        const original = byId.get(id)!;
        const copyId = `${actionId}:${id}`;
        await appendOnce(projects, action.targetSlug, {
          id: copyId,
          type: original.type,
          content: { ...original.content, movedFrom: { project: action.sourceSlug, entryId: id } },
          created_at: now(),
        });
        targetEntryIds.push(copyId);
      }
      // 2) ...then leave a marker in the source. The original entries stay
      // exactly where they are; readers treat `moved_to` as "superseded".
      await appendOnce(projects, action.sourceSlug, {
        id: `${actionId}:moved`,
        type: "observation",
        content: {
          kind: "moved_to",
          text: `${action.entryIds.length} ${action.entryIds.length === 1 ? "entry" : "entries"} moved to project ${action.targetSlug}`,
          entryIds: action.entryIds,
          targetProject: action.targetSlug,
          targetEntryIds,
        },
        created_at: now(),
      });
      return {
        result: { targetEntryIds },
        inverse: { type: "move_entries", sourceSlug: action.targetSlug, targetSlug: action.sourceSlug, entryIds: targetEntryIds },
      };
    }

    case "write_synthesis": {
      await requireProject(projects, action.slug);
      // Every source must still exist — a synthesis with dangling references
      // is worse than none.
      const logs = new Map<string, Set<string>>();
      for (const source of action.sources) {
        await requireProject(projects, source.slug);
        let ids = logs.get(source.slug);
        if (!ids) {
          ids = new Set((await projects.readMemory(source.slug)).map((e) => e.id));
          logs.set(source.slug, ids);
        }
        if (!ids.has(source.entryId)) throw new Error(`Source entry not found in ${source.slug}: ${source.entryId}`);
      }
      await appendOnce(projects, action.slug, {
        id: actionId,
        type: "observation",
        content: { kind: "synthesis", title: action.title, text: action.content, sources: action.sources },
        created_at: now(),
      });
      return { result: { entryId: actionId }, inverse: null };
    }
  }
}

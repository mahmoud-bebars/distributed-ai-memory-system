import { canAccessProject, type TokenAuth } from "../tokens";
import type { ProjectRow } from "../../db/schema";
import type { MemoryEntry } from "../projects/schema";
import { ProjectsService } from "../projects/service";
import type { Action, PlanInput } from "./schema";

/** Checks a structurally valid plan against the real world BEFORE a human
 *  ever sees it: every project/entry it references must exist and be
 *  reachable by the proposer's token, slugs it wants to create must be free,
 *  and moves must be between two different projects. Returns a list of
 *  human-readable problems — empty means the plan may be stored as pending.
 *  A project outside the token's allow-list is reported exactly like a
 *  missing one, so validation errors can't be used to probe what exists.
 *  (Execution re-checks all of this again — state can change between
 *  proposal and approval.) */
export async function validatePlan(
  projects: ProjectsService,
  auth: TokenAuth,
  plan: PlanInput,
  // When set (the assistant), existing projects must also be inside this set —
  // the projects that turn is allowed to read (opted in to global search, or
  // named by the user). A project outside it is reported as unknown.
  readableSlugs?: ReadonlySet<string>,
): Promise<string[]> {
  const errors: string[] = [];
  const rows = await projects.list();
  const bySlug = new Map<string, ProjectRow>(rows.map((p) => [p.slug, p]));
  const logs = new Map<string, Set<string>>();

  const knownProject = (slug: string): boolean =>
    bySlug.has(slug) && canAccessProject(auth, slug) && (readableSlugs === undefined || readableSlugs.has(slug));
  const entryIds = async (slug: string): Promise<Set<string>> => {
    let ids = logs.get(slug);
    if (!ids) {
      const entries: MemoryEntry[] = await projects.readMemory(slug);
      ids = new Set(entries.map((e) => e.id));
      logs.set(slug, ids);
    }
    return ids;
  };

  const requireProject = (where: string, slug: string): boolean => {
    if (knownProject(slug)) return true;
    errors.push(`${where}: Unknown project: ${slug}`);
    return false;
  };
  const requireEntries = async (where: string, slug: string, wanted: string[]): Promise<void> => {
    const ids = await entryIds(slug);
    const missing = wanted.filter((id) => !ids.has(id));
    if (missing.length > 0) errors.push(`${where}: entries not found in ${slug}: ${missing.join(", ")}`);
  };

  const creating = new Set<string>();

  for (const [i, action] of plan.actions.entries()) {
    const where = `action ${i + 1} (${action.type})`;
    await checkAction(action, where);
  }

  for (const [i, cite] of plan.citations.entries()) {
    if (requireProject(`citation ${i + 1}`, cite.slug)) await requireEntries(`citation ${i + 1}`, cite.slug, [cite.entryId]);
  }

  return errors;

  async function checkAction(action: Action, where: string): Promise<void> {
    switch (action.type) {
      case "create_project": {
        // A restricted token can't create projects over REST either.
        if (auth.projects !== null) errors.push(`${where}: a project-restricted token cannot create projects`);
        if (bySlug.has(action.slug) || creating.has(action.slug)) {
          errors.push(`${where}: Project already exists: ${action.slug}`);
        }
        creating.add(action.slug);
        return;
      }
      case "update_project":
      case "archive_project":
        requireProject(where, action.slug);
        return;
      case "tag_entries":
        if (requireProject(where, action.slug)) await requireEntries(where, action.slug, action.entryIds);
        return;
      case "move_entries": {
        if (action.sourceSlug === action.targetSlug) errors.push(`${where}: source and target must differ`);
        const sourceOk = requireProject(where, action.sourceSlug);
        // A project created earlier in this same plan is a legitimate target.
        const targetOk = creating.has(action.targetSlug) || requireProject(where, action.targetSlug);
        if (sourceOk && targetOk) await requireEntries(where, action.sourceSlug, action.entryIds);
        return;
      }
      case "write_synthesis": {
        if (!creating.has(action.slug)) requireProject(where, action.slug);
        for (const source of action.sources) {
          if (requireProject(where, source.slug)) await requireEntries(where, source.slug, [source.entryId]);
        }
        return;
      }
    }
  }
}

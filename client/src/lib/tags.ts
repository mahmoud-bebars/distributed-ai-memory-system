// project.tags is stored server-side as JSON.stringify(string[]) (see
// ProjectsService.create/update) — "[]" when empty, not a comma-separated
// string.
export function parseTags(tags: string): string[] {
  try {
    const parsed: unknown = JSON.parse(tags);
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === "string") : [];
  } catch {
    return [];
  }
}

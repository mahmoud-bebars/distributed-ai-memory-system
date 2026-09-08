const SEED_TEMPLATE = `I want you to seed this project's memory in my distributed-ai-memory-system
(the "dams" MCP server) with what you learn from exploring this repo.

Step 0 — connection check
Run \`claude mcp list\`. If "dams" isn't listed or shows disconnected, tell
me and stop. If connected, proceed.

Step 1 — read before writing
Call read_memory for "{PROJECT_SLUG}" first. Don't create entries that
duplicate what's already there — if something already exists, skip it
or note that it needs updating rather than adding a near-duplicate.

Step 2 — actually explore, don't guess
Read package.json, the README, the top-level source structure, and
recent git log (last ~20 commits) to build a real picture of this
project — what it is, its major components/services, how they relate,
and any non-obvious decisions or conventions baked into the code. Don't
write memory entries from assumptions about what a project like this
"probably" contains.

Step 3 — write memory in this shape
- type "entity": content = { name: "<component/service name>",
  category: "<one of: concept, event, feature, organization, person,
  product, project, research, technology, other>" } — pick what
  actually fits, don't default everything to "other".
- type "relation": content = { source: "<entity name>", target: "<entity
  name>", label: "<how they relate>" } — both must match entity names
  you've already created.
- type "observation": content = { text: "<plain-language note>",
  entity: "<entity name, if this is specifically about one>" } — omit
  entity for general project-level notes.

Prioritize a handful of genuinely meaningful entities over an entry for
every file. 10 that mean something beats 50 that don't.

Step 4 — push them
Call append_memory on "{PROJECT_SLUG}" for each entry.

Step 5 — confirm
Read the memory back and summarize what you added, including the
category for each entity.`;

const SYNC_TEMPLATE = `I want you to sync this project's memory in my distributed-ai-memory-system
(the "dams" MCP server) — updating it with what's changed since it was
last seeded, not redoing everything from scratch.

Step 0 — connection check
Run \`claude mcp list\`. If "dams" isn't listed or shows disconnected, tell
me and stop.

Step 1 — read current memory
Call read_memory for "{PROJECT_SLUG}". Note what entities, relations,
and observations already exist — this is your baseline.

Step 2 — find what's actually changed
Check recent git log and the current state of package.json/README/
source structure. Compare against what's already in memory: what's new,
what's changed, what's now inaccurate?

Step 3 — update, don't duplicate
- New components/services → append_memory as new entities (with a
  category).
- Existing entities that changed meaningfully → update_entity rather
  than creating a near-duplicate.
- New relationships → append_memory as relations.
- New decisions/gotchas/conventions worth remembering → append_memory as
  observations ({ text, entity? }).
- If nothing meaningful changed, say so — don't invent entries just to
  have something to report.

Step 4 — confirm
Read memory back and summarize exactly what changed: entities added,
entities updated, new relations/observations, and anything you decided
not to add and why.`;

function substituteSlug(template: string, slug: string): string {
  return template.split("{PROJECT_SLUG}").join(slug);
}

export function seedPrompt(slug: string): string {
  return substituteSlug(SEED_TEMPLATE, slug);
}

export function syncPrompt(slug: string): string {
  return substituteSlug(SYNC_TEMPLATE, slug);
}

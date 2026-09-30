const SEED_TEMPLATE = `I want you to seed this project's memory in my distributed-ai-memory-system
(the "dams" MCP server) by doing a DEEP exploration of this repo — the goal
is to surface things I may not know are there (hidden conventions, gotchas,
coupling between parts, the reasons behind decisions), not to summarize the
README back to me.

Step 0 — connection check
Run \`claude mcp list\`. If "dams" isn't listed or shows disconnected, tell
me and stop. If connected, proceed.

Step 1 — read before writing
Call read_memory for "{PROJECT_SLUG}" first. Don't create entries that
duplicate what's already there — if something already exists, skip it
or note that it needs updating rather than adding a near-duplicate.

Step 2 — survey the corpus
List every tracked file (git ls-files, or a directory walk that skips
node_modules, build output and lockfiles). Classify them: source code,
config/infra, migrations/schemas, docs, tests, scripts. Report counts and
tell me the plan. If the repo is huge (roughly 500+ files), tell me which
subdirectories you'll cover first instead of skimming everything.

Step 3 — structural pass (what the code literally says)
Read the actual source, not just the top level. Go through the files in
chunks of about 20-25, one area at a time (entry points, each module or
package, data layer, API surface, config/deploy, tests). For each chunk
note, from the code itself: what it defines, what it imports/calls, what
it reads and writes (DB tables, storage, env vars, external services),
and which files depend on it. Everything recorded from this pass is
explicit in the source.

Step 4 — semantic pass (what the code means)
Now look for what a parser can't see:
- Rationale: comments containing NOTE / WHY / HACK / TODO / FIXME, long
  explanatory comments, commit messages and docs explaining a decision or
  trade-off. Capture the *why*, not the what.
- Hidden coupling: two parts that must change together though nothing
  imports between them (a schema and the UI that assumes its shape, a
  hand-kept-in-sync copy, a config value read elsewhere by name).
- Invariants and conventions: rules the code enforces or silently relies
  on (append-only logs, ordering, naming schemes, auth boundaries).
- Similar solutions: concepts that solve the same problem in different
  places without referencing each other.
- Gotchas: anything that would surprise a new contributor or has clearly
  bitten someone before (look at git log for "fix" commits and reverts).
Use git log (last ~50 commits, plus \`git log -S\` on anything odd) to
find why things are the way they are.

Step 5 — write memory in this shape
- type "entity": content = { name: "<component/service/concept name>",
  category: "<one of: concept, event, feature, organization, person,
  product, project, research, technology, other>", source: "<file
  path(s) it lives in>" } — pick the category that actually fits.
- type "relation": content = { source: "<entity name>", target: "<entity
  name>", label: "<calls | depends_on | reads | writes | implements |
  configures | must_change_with | similar_to | rationale_for | ...>",
  confidence: "<extracted | inferred | ambiguous>" } — both ends must
  match entity names you've already created.
- type "observation": content = { text: "<plain-language note>",
  entity: "<entity name, if about one>", source: "<file:line or commit>",
  confidence: "<extracted | inferred | ambiguous>" } — omit entity for
  general project-level notes.

Confidence is mandatory on relations and non-trivial observations:
- extracted: explicit in the code/docs/commit (an import, a call, a
  comment that states it). Cite the source.
- inferred: you concluded it from several pieces of evidence. Say what
  evidence in the text.
- ambiguous: you suspect it but couldn't confirm. Include it, flagged —
  never drop an uncertain finding, and never present a guess as fact.
Never invent a relation or a fact to make the graph look complete.

Entity names must be stable and specific (the same thing gets the same
name everywhere; never suffix names with counters). Record rationale as
observations attached to the entity they explain, not as separate
entities. Use a group of entities only when 3+ of them form one flow that
pairwise relations don't capture — then add an observation describing the
flow and name each member in it (keep these rare).

Depth over noise: capture every component that has its own responsibility
and every non-obvious rule, but skip trivia (one entry per utility file,
restated imports, things obvious from a filename).

Step 6 — push them
Call append_memory on "{PROJECT_SLUG}" for each entry. Entities first,
then relations, then observations.

Step 7 — report
Read the memory back and give me: the entities added (with category), the
most-connected components, any surprising connections you found between
parts that seem unrelated, everything you flagged ambiguous, files you
skipped and why, and three questions about the project that this memory
now lets me ask.`;

const SYNC_TEMPLATE = `I want you to sync this project's memory in my distributed-ai-memory-system
(the "dams" MCP server) — updating it with what's changed since it was
last seeded, using the same deep method as the seed, but only on what's
new or changed. Don't redo everything from scratch.

Step 0 — connection check
Run \`claude mcp list\`. If "dams" isn't listed or shows disconnected, tell
me and stop.

Step 1 — read current memory (your cache)
Call read_memory for "{PROJECT_SLUG}". This is your baseline. Build a map
of entity name -> source files, and note every observation's source and
confidence. Anything already covered and still true is cached: don't
re-extract it.

Step 2 — find the changed set
Work out when memory was last written (the newest entry id/timestamp),
then list what changed since: \`git log --since\`, \`git diff --stat\` against
the commit nearest that date, plus uncommitted changes. Bucket files as
added, modified, deleted or renamed. Also flag any entity whose source
file no longer exists. Report the counts and the plan. If nothing
relevant changed, say so and stop — don't invent entries to have
something to report.

Step 3 — re-run the deep pass on the changed set only
Read the changed files in chunks of about 20-25, plus the files they
depend on or that depend on them (use the existing relations to find
neighbours). For each chunk do both passes:
- Structural: what it now defines, imports/calls, reads and writes.
- Semantic: new or changed rationale (NOTE/WHY/HACK comments, commit
  messages), hidden coupling, invariants, gotchas, and anything that
  makes an existing observation wrong.

Step 4 — reconcile against memory
For every finding, decide which of these it is:
- New component or concept -> append_memory as an entity (with category
  and source).
- Existing entity that changed (renamed responsibility, moved file, new
  behaviour) -> update_entity with the changed fields, keeping the exact
  same name so it stays one entity.
- New relationship -> append_memory as a relation with a label and
  confidence.
- Existing relation or observation that is now wrong -> the log is
  append-only, so append a corrected observation on that entity that
  says what changed and when (cite the commit); don't try to edit or
  delete the old one.
- New decision, gotcha or convention -> append_memory as an observation
  with source and confidence.
- Deleted component -> append an observation on that entity saying it
  was removed, with the commit; don't drop the entity.
Every relation and non-trivial observation needs confidence: extracted
(explicit in code/docs/commit, cite it), inferred (concluded from
several pieces of evidence, say which), or ambiguous (suspected but
unconfirmed — include it flagged, never drop it or present it as fact).
Never invent a relation or fact. Keep entity names stable; don't create a
near-duplicate of one that already exists.

Step 5 — confirm
Read memory back and summarize exactly what changed: entities added,
entities updated, corrections appended, new relations/observations,
anything flagged ambiguous, files you skipped and why, and anything you
saw but decided not to add and why.`;

const AUTO_SYNC_TEMPLATE = `I want you to set up continuous memory syncing for this project in my
distributed-ai-memory-system (the "dams" MCP server) — going forward, you
should proactively notice when something worth remembering changes in
this codebase and ask me whether to sync it, instead of only syncing
when I explicitly run the sync prompt.

Step 0 — connection check
Run \`claude mcp list\`. If "dams" isn't listed or shows disconnected, tell
me and stop.

Step 1 — find where to record this instruction
Check whether CLAUDE.md and/or AGENTS.md exist at the repo root.
- If only one exists, use that one.
- If both exist, ask me which one to add this to before writing anything.
- If neither exists, ask me whether to create one (and which filename)
  before writing anything.
Never guess — this becomes a standing instruction future sessions read
and act on, so getting the file wrong means it's silently never followed.

Step 2 — append the standing instruction
Add a section (creating one if the file doesn't have one yet) along
these lines, with the actual project slug substituted in:

    ## Memory sync ("{PROJECT_SLUG}")
    This project's memory lives in the distributed-ai-memory-system
    ("dams" MCP server) under the slug "{PROJECT_SLUG}". Whenever you
    make or notice a change worth remembering — a new component, a
    changed architectural decision, a new convention, a resolved
    gotcha — ask me whether to sync it into memory before doing so.
    Call read_memory first so you don't propose something that's
    already there. Never call append_memory or update_entity without
    my explicit approval in that moment, even though this instruction
    says to watch proactively — approval is per-change, not blanket.

Step 3 — confirm
Show me the diff of what you added and where, then read the file back
to confirm it's actually there.

From this point on, in every session on this repo: watch for changes
worth remembering, ask before syncing, never sync silently — this
should feel like a CI check that always asks first, not automation
that runs unattended.`;

function substituteSlug(template: string, slug: string): string {
  return template.split("{PROJECT_SLUG}").join(slug);
}

export function seedPrompt(slug: string): string {
  return substituteSlug(SEED_TEMPLATE, slug);
}

export function syncPrompt(slug: string): string {
  return substituteSlug(SYNC_TEMPLATE, slug);
}

export function autoSyncPrompt(slug: string): string {
  return substituteSlug(AUTO_SYNC_TEMPLATE, slug);
}

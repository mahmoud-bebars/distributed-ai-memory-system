import { CopyButton } from "@/components/CopyButton";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

// Built from wherever this page is being served, not hardcoded — a self-hosted
// deployer's Guide page should show their own domain, not the original author's.
// The token itself isn't filled in here (it's shown once, on the Tokens
// page, at creation time) — swap the placeholder for that value.
const CONNECT_COMMAND = `claude mcp add --transport http dams ${window.location.origin}/mcp --scope user --header "Authorization: Bearer dams_..."`;

// Kept in sync by hand with src/modules/mcp/service.ts's registerTool calls —
// there's no build-time link between this page and that file, so if a tool
// is added/changed/removed there, update this list too.
const TOOLS: { name: string; description: string }[] = [
  {
    name: "list_projects",
    description: "List all memory projects (slug, title, summary, tags, entry counts). Takes no arguments.",
  },
  {
    name: "read_memory",
    description:
      "Read the full memory log for a project. Returns every entry (entity/relation/observation) as parsed JSON objects.",
  },
  {
    name: "append_memory",
    description:
      "Append one entry to a project's append-only memory log. The entry must have an id (ulid), a type of entity/relation/observation, and a content object.",
  },
  {
    name: "update_entity",
    description:
      "Update an existing entity by appending a new revision that merges the given fields (e.g. category) onto its current content — last-write-wins, the append-only log keeps every prior revision. Fails if no entity with that name exists yet; use append_memory to create one.",
  },
  {
    name: "search_memory",
    description:
      "Hybrid (semantic + keyword) search across projects. Returns matching entries with citations (project, entry id, date, snippet). Searches projects that opted in to global search unless you name projects explicitly.",
  },
  {
    name: "propose_actions",
    description:
      "Propose a plan (create/update/archive a project, tag or move entries, write a synthesis). Files it as pending — nothing runs until the owner approves it on the Plans page; creating a project needs a separate, typed confirmation.",
  },
  {
    name: "list_tasks",
    description: "List what the global assistant is doing: active and recently finished tasks.",
  },
  {
    name: "get_task",
    description: "Get one assistant task by id, with its status, linked plan and event history.",
  },
  {
    name: "ask_memory",
    description:
      "Ask a natural-language question and get an answer synthesized from a project's memory, plus the entries it used as sources.",
  },
];

// Each step collapses so the page never grows taller than the viewport
// regardless of how much a step's content ends up saying — a fixed set of
// Cards stacked top to bottom had no such ceiling, and grew past visible
// height as steps gained more detail (e.g. the project-restriction note
// below). "1. Create a token" starts open since it's the immediate next
// action for a first-time visitor; the rest are one click away.
export function GuidePage() {
  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col gap-4 overflow-y-auto pb-8">
      <div>
        <h2 className="text-lg font-semibold leading-tight">Guide</h2>
        <p className="text-sm text-muted-foreground">
          Connecting an AI client to this memory store over MCP.
        </p>
      </div>

      <Accordion
        type="single"
        collapsible
        defaultValue="create-token"
        className="rounded-xl border border-border bg-card px-4"
      >
        <AccordionItem value="create-token">
          <AccordionTrigger>1. Create a token</AccordionTrigger>
          <AccordionContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              On the <span className="font-medium text-foreground">Tokens</span> page, create one
              scoped to <code className="text-xs">read_write</code> (or{" "}
              <code className="text-xs">read_only</code> for a client that should never mutate
              anything) and copy it — it's shown exactly once.
            </p>
            <p className="text-sm text-muted-foreground">
              For an internet-facing or otherwise untrusted agent, restrict the token to specific
              projects in the picker — it will only ever see or act on those, and every other
              project 404s as if it didn't exist.
            </p>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="connect-mcp">
          <AccordionTrigger>2. Add the MCP connector</AccordionTrigger>
          <AccordionContent className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Run this once per machine, in a terminal with Claude Code installed, swapping in the
              token you just created:
            </p>
            <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-2.5">
              <code className="flex-1 overflow-x-auto text-xs whitespace-pre">{CONNECT_COMMAND}</code>
              <CopyButton text={CONNECT_COMMAND} size="sm" />
            </div>
            <p className="text-xs text-muted-foreground">
              No further login step — the token in that header is the whole credential.
              <code className="text-xs">read_only</code> tokens simply never see the mutating
              tools below.
            </p>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="tools">
          <AccordionTrigger>3. Available tools</AccordionTrigger>
          <AccordionContent>
            <ul className="space-y-3">
              {TOOLS.map((tool) => (
                <li key={tool.name}>
                  <code className="text-sm font-medium">{tool.name}</code>
                  <p className="text-sm text-muted-foreground">{tool.description}</p>
                </li>
              ))}
            </ul>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="troubleshooting">
          <AccordionTrigger>If something's not connecting</AccordionTrigger>
          <AccordionContent>
            <p className="text-sm text-muted-foreground">
              Run <code className="text-xs">claude mcp get dams</code> for the specific error. Most
              connection issues so far have been Cloudflare Access intercepting a path it shouldn't
              — check the Access application's path rules before assuming the Worker code is at
              fault.
            </p>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}

import { CopyButton } from "@/components/CopyButton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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
    name: "ask_memory",
    description: "Ask a natural-language question and get an answer synthesized from a project's memory.",
  },
];

export function GuidePage() {
  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col gap-4 overflow-y-auto pb-8">
      <div>
        <h2 className="text-lg font-semibold leading-tight">Guide</h2>
        <p className="text-sm text-muted-foreground">
          Connecting an AI client to this memory store over MCP.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>1. Create a token</CardTitle>
        </CardHeader>
        <CardContent>
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2. Add the MCP connector</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>3. Available tools</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-3">
            {TOOLS.map((tool) => (
              <li key={tool.name}>
                <code className="text-sm font-medium">{tool.name}</code>
                <p className="text-sm text-muted-foreground">{tool.description}</p>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>If something's not connecting</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Run <code className="text-xs">claude mcp get dams</code> for the specific error. Most
            connection issues so far have been Cloudflare Access intercepting a path it shouldn't
            — check the Access application's path rules before assuming the Worker code is at
            fault.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

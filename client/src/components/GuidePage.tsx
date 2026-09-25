import { CopyButton } from "@/components/CopyButton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const CONNECT_COMMAND = "claude mcp add --transport http dams https://mcp.mahmoudbebars.dev/mcp --scope user";

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
          <CardTitle>1. Add the MCP connector</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Run this once, from any machine, in a terminal with Claude Code installed:
          </p>
          <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-2.5">
            <code className="flex-1 overflow-x-auto text-xs whitespace-pre">{CONNECT_COMMAND}</code>
            <CopyButton text={CONNECT_COMMAND} size="sm" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2. Authenticate</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Start a Claude Code session and run <code className="text-xs">/mcp</code>. It opens a
            GitHub login in your browser — only the single allow-listed GitHub account can
            complete it. Once authenticated, Claude Code can call the tools below against any
            project in this store.
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

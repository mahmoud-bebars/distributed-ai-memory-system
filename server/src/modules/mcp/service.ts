import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/cfworker";
import type { Bindings } from "../../lib/bindings";
import { ChatService } from "../chat";
import { DocsService } from "../docs";
import { ProjectsService } from "../projects";
import {
  appendDocInput,
  appendMemoryInput,
  askMemoryInput,
  deleteDocInput,
  readMemoryInput,
  updateDocInput,
  updateEntityInput,
} from "./schema";

// Shared confirm-first instruction for the two destructive doc tools. This
// is a prompt-level nudge only — MCP has no technical mechanism here to
// force a calling agent to actually pause and ask; a well-behaved client
// (Claude Code, etc.) will follow it, but nothing stops a misbehaving one
// from calling straight through. It is not an approval gate the way the
// browser chat's proposedAction flow (ChatService.ask) is.
const CONFIRM_FIRST_NOTICE =
  "Before calling this, confirm with the developer that they want this specific change made — don't call this on your own initiative, even if it seems like the obvious next step.";

const SERVER_INFO = { name: "distributed-ai-memory-system", version: "0.1.0" } as const;

// MCP tool results are `{ content: [...] }`. We return everything as a single
// text block of pretty JSON — MCP clients (Claude, etc.) read this fine and it
// keeps the tools honest thin wrappers over the service return values.
const jsonResult = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

const errorResult = (message: string) => ({
  content: [{ type: "text" as const, text: message }],
  isError: true,
});

/**
 * Builds a fresh `McpServer` exposing the project's memory as MCP tools.
 *
 * The tools are deliberately thin wrappers over `ProjectsService` /
 * `ChatService` — no business logic lives here. This is the "MCP is a
 * protocol wrapper, the REST layer is the real implementation" decision from
 * docs/PROJECT_UNDERSTANDING.md made concrete. Notably absent: `create_project`,
 * which stays a deliberate REST-API action rather than something an AI client
 * does unprompted.
 *
 * `CfWorkerJsonSchemaValidator` is passed explicitly so the SDK never falls
 * back to its Ajv default, which compiles schemas via `new Function` — banned
 * on the Workers runtime.
 */
export function buildMemoryMcpServer(env: Bindings): McpServer {
  const projects = new ProjectsService(env);
  const chat = new ChatService(env);
  const docs = new DocsService(env);

  const server = new McpServer(SERVER_INFO, {
    jsonSchemaValidator: new CfWorkerJsonSchemaValidator(),
  });

  server.registerTool(
    "list_projects",
    {
      description:
        "List all memory projects (slug, title, summary, tags, entry counts). Takes no arguments.",
      inputSchema: {},
    },
    async () => jsonResult(await projects.list()),
  );

  server.registerTool(
    "read_memory",
    {
      description:
        "Read the full memory log for a project. Returns every entry (entity/relation/observation) as parsed JSON objects.",
      inputSchema: readMemoryInput,
    },
    async ({ slug }) => jsonResult(await projects.readMemory(slug)),
  );

  server.registerTool(
    "append_memory",
    {
      description:
        "Append one entry to a project's append-only memory log. The entry must have an id (ulid), a type of entity/relation/observation, and a content object.",
      inputSchema: appendMemoryInput,
    },
    async ({ slug, entry }) => {
      try {
        await projects.appendMemory(slug, entry);
        return jsonResult({ ok: true });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : "Unknown error");
      }
    },
  );

  server.registerTool(
    "update_entity",
    {
      description:
        "Update an existing entity by appending a new revision that merges the given fields (e.g. category) onto its current content — last-write-wins, the append-only log keeps every prior revision. Fails if no entity with that name exists yet; use append_memory to create one.",
      inputSchema: updateEntityInput,
    },
    async ({ slug, name, category, fields }) => {
      try {
        const updates = { ...(fields ?? {}), ...(category !== undefined ? { category } : {}) };
        const entry = await projects.updateEntity(slug, name, updates);
        return jsonResult(entry);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : "Unknown error");
      }
    },
  );

  server.registerTool(
    "append_doc",
    {
      description:
        "Append content to a project's markdown doc file, stored separately from the memory log under {slug}/docs/{filename}.md. Creates the file if it doesn't exist yet; otherwise appends with a '---' separator and a timestamp heading, matching the project's append-only convention.",
      inputSchema: appendDocInput,
    },
    async ({ slug, filename, content }) => {
      try {
        await docs.append(slug, filename, content);
        return jsonResult({ ok: true });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : "Unknown error");
      }
    },
  );

  server.registerTool(
    "update_doc",
    {
      description:
        `Replace a project doc's entire content (full overwrite, not an append). Fails if no doc with that filename exists yet — use append_doc to create one first. ${CONFIRM_FIRST_NOTICE}`,
      inputSchema: updateDocInput,
    },
    async ({ slug, filename, content }) => {
      try {
        await docs.update(slug, filename, content);
        return jsonResult({ ok: true });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : "Unknown error");
      }
    },
  );

  server.registerTool(
    "delete_doc",
    {
      description: `Permanently delete a project doc file. This cannot be undone. ${CONFIRM_FIRST_NOTICE}`,
      inputSchema: deleteDocInput,
    },
    async ({ slug, filename }) => {
      try {
        await docs.delete(slug, filename);
        return jsonResult({ ok: true });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : "Unknown error");
      }
    },
  );

  server.registerTool(
    "ask_memory",
    {
      description:
        "Ask a natural-language question and get an answer synthesized from a project's memory.",
      inputSchema: askMemoryInput,
    },
    async ({ slug, question }) => {
      try {
        const { answer } = await chat.ask(slug, question);
        return jsonResult({ answer });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : "Unknown error");
      }
    },
  );

  return server;
}

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/cfworker";
import type { Bindings } from "../../lib/bindings";
import { ChatService } from "../chat";
import { ProjectsService } from "../projects";
import { appendMemoryInput, askMemoryInput, readMemoryInput } from "./schema";

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
 * PROJECT_UNDERSTANDING.md made concrete. Notably absent: `create_project`,
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

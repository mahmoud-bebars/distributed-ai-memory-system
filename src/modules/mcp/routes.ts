import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { Bindings } from "../../lib/bindings";
import { buildMemoryMcpServer } from "./service";

/**
 * The `/mcp` endpoint, as a plain `ExportedHandler` wired into the
 * OAuthProvider as its `apiHandler`. By the time a request lands here the
 * provider has already validated the bearer token, so this handler never does
 * its own auth — it just speaks MCP.
 *
 * Stateless by design: under the MCP 2026-07-28 spec the session handshake
 * (Mcp-Session-Id) was removed, so there's no session to keep a long-lived
 * server around for. Each request spins up a throwaway `McpServer` +
 * `WebStandardStreamableHTTPServerTransport` (`sessionIdGenerator: undefined`
 * → stateless mode) and lets them get GC'd afterwards. That's what lets this
 * run in a bare Worker with no Durable Object — the right trade for a
 * single-user server.
 */
export const mcpHandler = {
  async fetch(request: Request, env: Bindings): Promise<Response> {
    const server = buildMemoryMcpServer(env);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    await server.connect(transport);
    return transport.handleRequest(request);
  },
};

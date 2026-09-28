import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { Bindings } from "../../lib/bindings";
import type { TokenScope } from "../tokens";
import { buildMemoryMcpServer } from "./service";

/**
 * The `/mcp` endpoint's HTTP entry point, mounted in index.ts behind
 * `requireApiAuth({ minScope: "read_only" })` — by the time a request lands
 * here it's already been authenticated and its scope resolved; this
 * function never does its own auth, it just speaks MCP for that scope (see
 * service.ts's buildMemoryMcpServer for what the scope actually gates).
 *
 * Stateless by design: under the MCP 2026-07-28 spec the session handshake
 * (Mcp-Session-Id) was removed, so there's no session to keep a long-lived
 * server around for. Each request spins up a throwaway `McpServer` +
 * `WebStandardStreamableHTTPServerTransport` (`sessionIdGenerator: undefined`
 * → stateless mode) and lets them get GC'd afterwards. That's what lets this
 * run in a bare Worker with no Durable Object — the right trade for a
 * single-user server.
 */
export async function handleMcpRequest(
  request: Request,
  env: Bindings,
  scope: TokenScope,
): Promise<Response> {
  const server = buildMemoryMcpServer(env, scope);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  await server.connect(transport);
  return transport.handleRequest(request);
}

// The Gestaltung360 chat-plugin MCP server (Claude / ChatGPT connectors).
// Stateless Streamable HTTP via mcp-handler; tools live in lib/plugin/server.
// No cookies are read or set here (never import lib/supabase/server.ts).
import { createMcpHandler } from "mcp-handler";

import { corsPreflight, withCors } from "@/lib/plugin/server/cors";
import { realDeps } from "@/lib/plugin/server/deps";
import { registerPluginServer, SERVER_INFO, SERVER_INSTRUCTIONS } from "@/lib/plugin/server/register";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const handler = withCors(
  createMcpHandler((server) => registerPluginServer(server, realDeps()), {
    serverInfo: { ...SERVER_INFO },
    instructions: SERVER_INSTRUCTIONS,
  }),
);

export { handler as GET, handler as POST, handler as DELETE };

export function OPTIONS(): Response {
  return corsPreflight();
}

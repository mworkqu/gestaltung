// The Gestaltung360 chat-plugin MCP server (Claude / ChatGPT connectors).
// Stateless Streamable HTTP via mcp-handler; tools live in lib/plugin/server.
// No cookies are read or set here (never import lib/supabase/server.ts).
//
// Phase 4a: an OPTIONAL bearer token. `required: false` is deliberate —
// everything from Phases 1-3 works with no account, and a token only adds what
// an account allows (a cart, a project in the account, a prefilled booking).
// A token that is present but not acceptable is answered 401 with a
// WWW-Authenticate challenge naming our RFC 9728 metadata, which is how a host
// knows to run (or redo) the OAuth flow against Supabase.
import { createMcpHandler, withMcpAuth } from "mcp-handler";

import { defaultSiteUrl } from "@/lib/email/brand-layout";
import { corsPreflight, withCors } from "@/lib/plugin/server/cors";
import { realDeps } from "@/lib/plugin/server/deps";
import { verifyPluginToken } from "@/lib/plugin/server/oauth";
import { registerPluginServer, SERVER_INFO, SERVER_INSTRUCTIONS } from "@/lib/plugin/server/register";
import { RESOURCE_METADATA_PATH } from "@/lib/plugin/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const handler = withCors(
  withMcpAuth(
    createMcpHandler((server) => registerPluginServer(server, realDeps()), {
      serverInfo: { ...SERVER_INFO },
      instructions: SERVER_INSTRUCTIONS,
    }),
    verifyPluginToken,
    {
      required: false,
      resourceMetadataPath: RESOURCE_METADATA_PATH,
      // Behind Cloudflare the request origin is not ours, and a challenge that
      // names the wrong host sends the host to a metadata document that does
      // not exist. Our own site URL is the only right answer here.
      resourceUrl: defaultSiteUrl(),
    },
  ),
);

export { handler as GET, handler as POST, handler as DELETE };

export function OPTIONS(): Response {
  return corsPreflight();
}

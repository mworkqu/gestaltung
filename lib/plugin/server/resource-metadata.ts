/**
 * RFC 9728 protected-resource metadata for our MCP endpoint (Phase 4a).
 *
 * This is how a host discovers that Supabase Auth is the authorization server
 * in front of us. It is served at BOTH the bare path and the path-scoped one
 * (`/.well-known/oauth-protected-resource/api/mcp`), because clients differ on
 * which they fetch, and it is the same document either way.
 *
 * It is public and says nothing about any person.
 */
import "server-only";

import { generateProtectedResourceMetadata } from "mcp-handler";

import { defaultSiteUrl } from "@/lib/email/brand-layout";
import { supabaseEnv } from "@/lib/supabase/env";
import { ALL_PLUGIN_SCOPES, mcpResourceUrl, supabaseIssuer } from "../oauth";
import { MCP_CORS_HEADERS } from "./cors";

/** The document, or null when Supabase is not configured. */
function resourceMetadataBody(): Record<string, unknown> | null {
  const env = supabaseEnv();
  if (!env) return null;
  const site = defaultSiteUrl();
  return generateProtectedResourceMetadata({
    authServerUrls: [supabaseIssuer(env.url)],
    resourceUrl: mcpResourceUrl(site),
    additionalMetadata: {
      scopes_supported: [...ALL_PLUGIN_SCOPES],
      bearer_methods_supported: ["header"],
      resource_documentation: `${site}/en/legal/privacy`,
    },
  }) as unknown as Record<string, unknown>;
}

/**
 * The answer. A 404 when there is no authorization server to point at, because
 * advertising one that cannot answer makes a host retry the whole flow forever.
 */
export function resourceMetadataResponse(): Response {
  const body = resourceMetadataBody();
  if (!body) return Response.json({ error: "not_configured" }, { status: 404, headers: MCP_CORS_HEADERS });
  return Response.json(body, {
    headers: { ...MCP_CORS_HEADERS, "Cache-Control": "public, max-age=3600" },
  });
}

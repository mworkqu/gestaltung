// RFC 9728, path-scoped to the resource it describes (/api/mcp). This is the
// URL our 401 challenges name in WWW-Authenticate.
import { corsPreflight } from "@/lib/plugin/server/cors";
import { resourceMetadataResponse } from "@/lib/plugin/server/resource-metadata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(): Response {
  return resourceMetadataResponse();
}

export function OPTIONS(): Response {
  return corsPreflight();
}

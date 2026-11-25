// RFC 9728: the bare protected-resource path. Same document as the path-scoped
// one under /api/mcp; clients differ on which they fetch.
// Middleware never sees this path (its matcher skips anything with a dot), so
// it is not locale-prefixed and no session cookie is touched.
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

/**
 * CORS for the public MCP endpoint (/api/mcp). Browser-based MCP clients (and
 * the MCP inspector) call it cross-origin; nothing on it reads cookies, so a
 * wildcard origin is safe. Pure: wraps any web-standard handler.
 */

export const MCP_CORS_HEADERS: Readonly<Record<string, string>> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, accept, mcp-protocol-version, mcp-session-id, authorization",
  "Access-Control-Expose-Headers": "mcp-session-id",
  "Access-Control-Max-Age": "86400",
};

/** Same response with the CORS headers set (a new Response when the headers are immutable). */
export function withCorsHeaders(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(MCP_CORS_HEADERS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export function withCors(handler: (req: Request) => Promise<Response>): (req: Request) => Promise<Response> {
  return async (req) => withCorsHeaders(await handler(req));
}

/** The preflight answer: 204 with the CORS headers. */
export function corsPreflight(): Response {
  return new Response(null, { status: 204, headers: MCP_CORS_HEADERS });
}

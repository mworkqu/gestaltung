// CAD Champions server clock. The test timer counts down to a deadline set on
// the server; the browser calls this on load and every 60 s to measure the
// offset between its clock and ours. Returns nothing but the time, so it needs
// no session.

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    { now: Date.now() },
    { headers: { "Cache-Control": "no-store, max-age=0", "X-Robots-Tag": "noindex" } }
  );
}

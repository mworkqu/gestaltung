import { runRetirements } from "@/lib/integrations/youtube-retire";

// Daily retire-log run (vercel.json cron, 07:00 UTC = 10:00 Qatar, right after
// Google resets the YouTube quota). Deletes the outdated videos whose grace
// period is over from YouTube and from the site's links. Vercel sends CRON_SECRET.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response(null, { status: 401 });
  }
  const result = await runRetirements();
  return Response.json(result);
}

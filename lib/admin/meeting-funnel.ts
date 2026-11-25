import "server-only";

// Admin Funnel card: paid engineer meetings of the last 30 days (migration
// 0113). Returns null when the table is missing or unreadable, so the card
// hides the rows instead of failing — the same contract as plugin-funnel.ts.
// Test rows are left out.

type Res = PromiseLike<{ data: unknown; error: unknown; count?: number | null }>;
type Q = {
  select: (cols: string, opts?: { count: "exact"; head: true }) => Q;
  gte: (c: string, v: string) => Q;
  eq: (c: string, v: unknown) => Q;
  not: (c: string, op: string, v: unknown) => Q;
} & Res;
type Loose = { from: (t: string) => Q };

export type MeetingFunnel = { booked: number; done: number; invoiced: number; paid: number };

/** Statuses that count as "the meeting happened" for the Done row. */
const HAPPENED = ["done", "invoiced", "paid"];

export async function loadMeetingFunnel(db: unknown, sinceIso: string): Promise<MeetingFunnel | null> {
  const c = db as Loose;
  try {
    const count = (build: (q: Q) => Q) => build(c.from("meeting_bookings").select("id", { count: "exact", head: true }).gte("starts_at", sinceIso));

    // Booked = every live meeting in the window (cancelled and no-shows are not bookings we earn from).
    const booked = await count((q) => q.not("status", "in", "(cancelled,no_show)").not("is_test", "is", true));
    if (booked.error) return null;

    const [done, invoiced, paid] = await Promise.all([
      count((q) => q.not("is_test", "is", true).not("status", "in", `(${["cancelled", "no_show", "booked"].join(",")})`)),
      count((q) => q.not("is_test", "is", true).not("status", "in", "(cancelled,no_show,booked,done)")),
      count((q) => q.not("is_test", "is", true).eq("status", "paid")),
    ]);

    return {
      booked: booked.count ?? 0,
      done: done.error ? 0 : (done.count ?? 0),
      invoiced: invoiced.error ? 0 : (invoiced.count ?? 0),
      paid: paid.error ? 0 : (paid.count ?? 0),
    };
  } catch {
    return null;
  }
}

/** Exported for the test: which statuses the Done row counts. */
export const MEETING_HAPPENED_STATUSES = HAPPENED;

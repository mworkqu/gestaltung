import { beforeEach, describe, expect, it, vi } from "vitest";

const sent: { to: string[]; subject: string; html: string; text?: string; idempotencyKey?: string }[] = [];
let failNext = false;

vi.mock("@/lib/email", () => ({
  OWNER_EMAIL: "owner@example.test",
  sendEmailResult: async (opts: { to: string[]; subject: string; html: string; text?: string; idempotencyKey?: string }) => {
    if (failNext) {
      failNext = false;
      return { ok: false, error: "no_resend_key" };
    }
    sent.push(opts);
    return { ok: true };
  },
}));

const { runMeetingReminders } = await import("./reminders-core");
const { DEFAULT_MEETING_SETTINGS } = await import("./settings");

// Sunday 22 Nov 2026, 12:00 Qatar. "Tomorrow" is Monday 23 November.
const NOW = new Date("2026-11-22T09:00:00Z");
const MON_16 = "2026-11-23T13:00:00.000Z";
const MON_17 = "2026-11-23T14:00:00.000Z";

type Row = Record<string, unknown>;

/** The slice of DbClient reminders-core uses: store_settings + meeting_bookings. */
function fakeDb(opts: { rows?: Row[]; settingsMissing?: boolean; tableMissing?: boolean; settings?: unknown }) {
  const captured: { from: string[]; range: (string | undefined)[] } = { from: [], range: [] };

  const builder = (table: string) => {
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    for (const m of ["select", "eq", "gte", "lt", "not", "order"]) {
      chain[m] = (...args: unknown[]) => {
        if (m === "gte" || m === "lt") captured.range.push(String(args[1]));
        return self();
      };
    }
    chain.maybeSingle = async () =>
      opts.settingsMissing
        ? { data: null, error: { code: "42P01", message: 'relation "store_settings" does not exist' } }
        : { data: { value: opts.settings ?? DEFAULT_MEETING_SETTINGS }, error: null };
    // meeting_bookings resolves as a thenable at the end of the chain.
    chain.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve(
        opts.tableMissing
          ? { data: null, error: { code: "42P01", message: 'relation "meeting_bookings" does not exist' } }
          : { data: opts.rows ?? [], error: null },
      ).then(resolve);
    captured.from.push(table);
    return chain;
  };

  return { db: { from: builder } as never, captured };
}

const row = (over: Partial<Row> = {}): Row => ({
  id: "11111111-1111-1111-1111-111111111111",
  starts_at: MON_16,
  mode: "online",
  name: "Noora",
  phone: "+97455551234",
  email: "noora@example.com",
  locale: "en",
  topic: null,
  meet_link: null,
  invoice_qar: 150,
  ...over,
});

describe("meeting reminders", () => {
  beforeEach(() => {
    sent.length = 0;
    failNext = false;
  });

  it("emails each client with an address and one list to the owner", async () => {
    const { db } = fakeDb({ rows: [row(), row({ id: "22222222-1111-1111-1111-111111111111", starts_at: MON_17, name: "Ali", email: "ali@example.com" })] });
    const summary = await runMeetingReminders(db, "https://gestaltung360.com", NOW);

    expect(summary).toMatchObject({ tomorrow: 2, clientsEmailed: 2, clientsSkipped: 0, ownerEmailed: true });
    expect(sent).toHaveLength(3); // two clients + the owner

    const client = sent[0]!;
    expect(client.to).toEqual(["noora@example.com"]);
    expect(client.subject).toMatch(/tomorrow/i);
    expect(client.subject).toMatch(/Mon 23 Nov/);
    // no manage link exists for a reminder: only the token hash is stored
    expect(client.html).not.toMatch(/\/meetings\//);
    // one send per meeting per day, even if the cron runs twice
    expect(client.idempotencyKey).toBe("meeting-reminder-11111111-1111-1111-1111-111111111111-2026-11-23");

    const owner = sent[2]!;
    expect(owner.to).toEqual(["owner@example.test"]);
    expect(owner.subject).toBe("Meetings tomorrow — 2");
    expect(owner.text).toMatch(/Noora/);
    expect(owner.text).toMatch(/\+974 5555 1234/);
  });

  it("counts a client with no email as skipped and still tells the owner", async () => {
    const { db } = fakeDb({ rows: [row({ email: null })] });
    const summary = await runMeetingReminders(db, "https://gestaltung360.com", NOW);

    expect(summary).toMatchObject({ tomorrow: 1, clientsEmailed: 0, clientsSkipped: 1, ownerEmailed: true });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toEqual(["owner@example.test"]);
  });

  it("flags an online meeting that still has no link", async () => {
    const { db } = fakeDb({ rows: [row({ email: null, mode: "online", meet_link: null })] });
    await runMeetingReminders(db, "https://gestaltung360.com", NOW);
    expect(sent[0]!.text).toMatch(/NO MEET LINK YET/);

    sent.length = 0;
    const withLink = fakeDb({ rows: [row({ email: null, meet_link: "https://meet.google.com/abc" })] });
    await runMeetingReminders(withLink.db, "https://gestaltung360.com", NOW);
    expect(sent[0]!.text).not.toMatch(/NO MEET LINK YET/);
  });

  it("counts a failed send as skipped rather than sent", async () => {
    failNext = true;
    const { db } = fakeDb({ rows: [row()] });
    const summary = await runMeetingReminders(db, "https://gestaltung360.com", NOW);
    expect(summary).toMatchObject({ clientsEmailed: 0, clientsSkipped: 1 });
  });

  it("asks only for tomorrow in Qatar", async () => {
    const { db, captured } = fakeDb({ rows: [] });
    await runMeetingReminders(db, "https://gestaltung360.com", NOW);
    // 23 Nov 00:00 Qatar = 22 Nov 21:00Z, through 23 Nov 21:00Z
    expect(captured.range).toContain("2026-11-22T21:00:00.000Z");
    expect(captured.range).toContain("2026-11-23T21:00:00.000Z");
  });

  it("says nothing and sends nothing before migration 0113", async () => {
    const missingTable = fakeDb({ tableMissing: true });
    expect(await runMeetingReminders(missingTable.db, "https://x.test", NOW)).toMatchObject({ notSetUp: true, tomorrow: 0 });

    const missingSettings = fakeDb({ settingsMissing: true });
    expect(await runMeetingReminders(missingSettings.db, "https://x.test", NOW)).toMatchObject({ notSetUp: true });

    expect(sent).toHaveLength(0);
  });

  it("sends nothing when tomorrow is empty", async () => {
    const { db } = fakeDb({ rows: [] });
    expect(await runMeetingReminders(db, "https://x.test", NOW)).toMatchObject({ tomorrow: 0, ownerEmailed: false });
    expect(sent).toHaveLength(0);
  });
});

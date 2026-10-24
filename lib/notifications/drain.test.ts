import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const send = vi.hoisted(() => vi.fn());

vi.mock("@/lib/email", async (orig) => ({
  ...(await orig<typeof import("@/lib/email")>()),
  sendEmailResult: send,
}));
vi.mock("@/lib/contact-phone-server", async () => {
  const { DEFAULT_CONTACT_PHONE } = await import("@/lib/contact-phone");
  return { getContactPhone: async () => DEFAULT_CONTACT_PHONE, peekContactPhone: () => DEFAULT_CONTACT_PHONE };
});

import { drainOutbox, type ClaimedRow } from "./drain";

const ORDER = "1a2b3c4d-0000-4000-8000-000000000001";

const row = (over: Partial<ClaimedRow> = {}): ClaimedRow => ({
  id: "n1",
  user_id: "u1",
  kind: "first_project",
  payload: { ref: "r1", project_name: "Plant monitor" },
  locale: "en",
  email: " mona@example.com ",
  status: "queued",
  attempts: 0,
  token: "tok",
  unsubscribed_kinds: [],
  all_off: false,
  ...over,
});

type Mark = { id: string; status: string; error: string | null };

function fakeDb(opts: { rows: ClaimedRow[] | null; settings?: unknown; claimError?: string; markError?: boolean }) {
  const marks: Mark[] = [];
  const claims: unknown[] = [];
  const db = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === "claim_notifications") {
        claims.push(args);
        return opts.claimError ? { data: null, error: { message: opts.claimError } } : { data: opts.rows, error: null };
      }
      marks.push({ id: args.p_id as string, status: args.p_status as string, error: args.p_error as string | null });
      return { error: opts.markError ? { message: "boom" } : null };
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: opts.settings === undefined ? null : { value: opts.settings } }) }) }) }),
  } as unknown as SupabaseClient;
  return { db, marks, claims };
}

beforeEach(() => {
  send.mockReset();
  send.mockResolvedValue({ ok: true });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("drainOutbox", () => {
  it("claims with the limit, and an empty claim is a no-op", async () => {
    const { db, claims, marks } = fakeDb({ rows: [] });
    const r = await drainOutbox(db, "https://gestaltung360.com", 7);
    expect(claims).toEqual([{ p_limit: 7 }]);
    expect(r).toEqual({ ok: true, summary: { claimed: 0, sent: 0, failed: 0, skipped: 0, reasons: {} } });
    expect(marks).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });

  it("reports claim_failed (0046 not run) without sending", async () => {
    const { db } = fakeDb({ rows: null, claimError: "function not found" });
    expect(await drainOutbox(db, "https://x.test")).toEqual({ ok: false, error: "claim_failed", detail: "function not found" });
    expect(send).not.toHaveBeenCalled();
  });

  it("a successful send marks the row sent and passes recipient, headers and idempotency key", async () => {
    const { db, marks } = fakeDb({ rows: [row()] });
    const r = await drainOutbox(db, "https://gestaltung360.com/");
    expect(r).toMatchObject({ ok: true, summary: { claimed: 1, sent: 1, failed: 0, skipped: 0 } });
    expect(marks).toEqual([{ id: "n1", status: "sent", error: null }]);
    const mail = send.mock.calls[0][0];
    expect(mail.to).toEqual(["mona@example.com"]);
    expect(mail.subject.length).toBeGreaterThan(0);
    expect(mail.html).toContain("Plant monitor");
    expect(mail.idempotencyKey).toBe("notification-n1");
    expect(mail.headers["X-Entity-Ref-ID"]).toBe("n1");
    expect(mail.headers["List-Unsubscribe"]).toContain("https://gestaltung360.com/api/notifications/unsubscribe?token=tok&kind=first_project");
  });

  it("a failing send marks failure with the provider error and the loop continues", async () => {
    send.mockResolvedValueOnce({ ok: false, error: "resend 500" }).mockResolvedValueOnce({ ok: true });
    const { db, marks } = fakeDb({ rows: [row({ id: "a" }), row({ id: "b", email: "b@example.com" })] });
    const r = await drainOutbox(db, "https://x.test");
    expect(r).toMatchObject({ ok: true, summary: { claimed: 2, sent: 1, failed: 1 } });
    expect(marks).toEqual([
      { id: "a", status: "failed", error: "resend 500" },
      { id: "b", status: "sent", error: null },
    ]);
  });

  it("a thrown send is caught, marked failed with the message, and the loop continues", async () => {
    send.mockRejectedValueOnce(new Error("network down")).mockResolvedValueOnce({ ok: true });
    const { db, marks } = fakeDb({ rows: [row({ id: "a" }), row({ id: "b" })] });
    const r = await drainOutbox(db, "https://x.test");
    expect(r).toMatchObject({ ok: true, summary: { sent: 1, failed: 1 } });
    expect(marks[0]).toEqual({ id: "a", status: "failed", error: "exception: network down" });
    expect(marks[1].status).toBe("sent");
  });

  it("a failure without an error string falls back to send_failed", async () => {
    send.mockResolvedValueOnce({ ok: false });
    const { db, marks } = fakeDb({ rows: [row()] });
    await drainOutbox(db, "https://x.test");
    expect(marks[0].error).toBe("send_failed");
  });

  it("skips a kind the owner switched off, with reason 'disabled', and sends nothing", async () => {
    const { db, marks } = fakeDb({ rows: [row()], settings: { first_project: false } });
    const r = await drainOutbox(db, "https://x.test");
    expect(r).toMatchObject({ ok: true, summary: { skipped: 1, sent: 0, reasons: { disabled: 1 } } });
    expect(marks).toEqual([{ id: "n1", status: "skipped", error: "disabled" }]);
    expect(send).not.toHaveBeenCalled();
  });

  it("skips an opted-out user (unsubscribed) and a row with no email", async () => {
    const { db, marks } = fakeDb({
      rows: [row({ id: "a", unsubscribed_kinds: ["first_project"] }), row({ id: "b", email: null }), row({ id: "c", all_off: true })],
    });
    const r = await drainOutbox(db, "https://x.test");
    expect(r).toMatchObject({ ok: true, summary: { skipped: 3, reasons: { unsubscribed: 2, no_email: 1 } } });
    expect(marks.map((m) => m.error)).toEqual(["unsubscribed", "no_email", "unsubscribed"]);
  });

  it("skips an unknown kind", async () => {
    const { db, marks } = fakeDb({ rows: [row({ kind: "newsletter" })] });
    await drainOutbox(db, "https://x.test");
    expect(marks).toEqual([{ id: "n1", status: "skipped", error: "unknown_kind" }]);
  });

  it("order emails are transactional: sent despite opt-out, with no unsubscribe header or token", async () => {
    const { db, marks } = fakeDb({
      rows: [
        row({
          kind: "order_shipped",
          all_off: true,
          token: null,
          payload: { ref: ORDER, order_id: ORDER, order_short: "1a2b3c4d", status: "shipped" },
        }),
      ],
    });
    await drainOutbox(db, "https://gestaltung360.com");
    expect(marks).toEqual([{ id: "n1", status: "sent", error: null }]);
    const mail = send.mock.calls[0][0];
    expect(mail.headers["List-Unsubscribe"]).toBeUndefined();
    expect(mail.html).toContain(`https://gestaltung360.com/en/orders/${ORDER}`);
  });

  it("renders Arabic for locale ar and English for anything else", async () => {
    const { db } = fakeDb({ rows: [row({ id: "a", locale: "ar" }), row({ id: "b", locale: "fr" })] });
    await drainOutbox(db, "https://x.test");
    expect(send.mock.calls[0][0].html).toContain('dir="rtl"');
    expect(send.mock.calls[1][0].html).toContain('dir="ltr"');
  });

  it("a failing mark call does not abort the run", async () => {
    const { db } = fakeDb({ rows: [row({ id: "a" }), row({ id: "b" })], markError: true });
    const r = await drainOutbox(db, "https://x.test");
    expect(r).toMatchObject({ ok: true, summary: { sent: 2 } });
  });
});

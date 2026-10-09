import { describe, expect, it } from "vitest";
import {
  DEFAULT_KIND_SETTINGS,
  ORDER_KINDS,
  OUTBOX_KINDS,
  decide,
  discountWindow,
  isTransactional,
  dedupeKey,
  isRetryable,
  kindSettings,
  normaliseLocale,
  refOf,
  type OutboxRow,
  type Prefs,
} from "./decide";

const row = (over: Partial<OutboxRow> = {}): OutboxRow => ({
  id: "o1",
  user_id: "u1",
  kind: "credits_admin_grant",
  payload: { ref: "r1" },
  locale: "en",
  email: "client@example.com",
  status: "queued",
  attempts: 1,
  ...over,
});
const prefs = (over: Partial<Prefs> = {}): Prefs => ({ token: "tok", unsubscribed_kinds: [], all_off: false, ...over });
const allOn = kindSettings({ ...DEFAULT_KIND_SETTINGS, discount_ready: true });

describe("decide", () => {
  it("sends when enabled, subscribed and with an email", () => {
    expect(decide(row(), allOn, prefs())).toBe("send");
  });

  it("skips without an email", () => {
    expect(decide(row({ email: null }), allOn, prefs())).toEqual({ skip: "no_email" });
    expect(decide(row({ email: "   " }), allOn, prefs())).toEqual({ skip: "no_email" });
    expect(decide(row({ email: "not-an-email" }), allOn, prefs())).toEqual({ skip: "no_email" });
  });

  it("skips a kind the user unsubscribed from, but not other kinds", () => {
    const p = prefs({ unsubscribed_kinds: ["credits_admin_grant"] });
    expect(decide(row(), allOn, p)).toEqual({ skip: "unsubscribed" });
    expect(decide(row({ kind: "first_project" }), allOn, p)).toBe("send");
  });

  it("skips every kind when all_off", () => {
    const p = prefs({ all_off: true });
    for (const kind of ["credits_order_delivered", "credits_admin_grant", "first_project", "first_circuit"]) {
      expect(decide(row({ kind }), allOn, p)).toEqual({ skip: "unsubscribed" });
    }
  });

  it("skips a kind the owner disabled, before anything else", () => {
    const settings = kindSettings({ credits_admin_grant: false });
    expect(decide(row(), settings, prefs())).toEqual({ skip: "disabled" });
    expect(decide(row({ email: null }), settings, prefs({ all_off: true }))).toEqual({ skip: "disabled" });
  });

  it("discount_ready is ON by default since 0053 (missing setting), and the owner can switch it off", () => {
    expect(decide(row({ kind: "discount_ready" }), kindSettings(null), prefs())).toBe("send");
    expect(decide(row({ kind: "discount_ready" }), kindSettings({}), prefs())).toBe("send");
    expect(decide(row({ kind: "discount_ready" }), kindSettings({ discount_ready: false }), prefs())).toEqual({ skip: "disabled" });
  });

  it("skips unknown kinds and rows without an unsubscribe token", () => {
    expect(decide(row({ kind: "spam" }), allOn, prefs())).toEqual({ skip: "unknown_kind" });
    expect(decide(row(), allOn, prefs({ token: null }))).toEqual({ skip: "no_token" });
    expect(decide(row(), allOn, null)).toEqual({ skip: "no_token" });
  });
});

describe("kindSettings", () => {
  it("fills defaults and ignores non-boolean values", () => {
    const s = kindSettings({ first_project: false, first_circuit: "no", extra: true });
    expect(s.first_project).toBe(false);
    expect(s.first_circuit).toBe(true);
    expect(s.discount_ready).toBe(true);
    expect(s.order_delivered).toBe(true);
    expect(kindSettings([true])).toEqual(DEFAULT_KIND_SETTINGS);
  });
});

describe("isRetryable (retry rule)", () => {
  it("queued rows are tried", () => {
    expect(isRetryable({ status: "queued", attempts: 0 })).toBe(true);
  });
  it("failed rows are retried only while attempts < 3", () => {
    expect(isRetryable({ status: "failed", attempts: 1 })).toBe(true);
    expect(isRetryable({ status: "failed", attempts: 2 })).toBe(true);
    expect(isRetryable({ status: "failed", attempts: 3 })).toBe(false);
    expect(isRetryable({ status: "failed", attempts: 7 })).toBe(false);
  });
  it("sent and skipped rows are never retried", () => {
    expect(isRetryable({ status: "sent", attempts: 1 })).toBe(false);
    expect(isRetryable({ status: "skipped", attempts: 0 })).toBe(false);
  });
});

// DB-level dedupe is the unique index notification_outbox_dedupe in 0046,
// not this test; this only checks the key the index uses is read the same way.
describe("refOf / dedupeKey", () => {
  it("reads payload.ref", () => {
    expect(refOf({ ref: "abc" })).toBe("abc");
    expect(refOf({ ref: " abc " })).toBe("abc");
    expect(refOf({ ref: 42 })).toBe("42");
    expect(refOf({ ref: "" })).toBeNull();
    expect(refOf({})).toBeNull();
    expect(refOf(null)).toBeNull();
  });
  it("two ledger rows of one delivered order share a key; another order does not", () => {
    const order = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
    const a = dedupeKey({ user_id: "u1", kind: "credits_order_delivered", payload: { ref: order, circuit_credits: 3 } });
    const b = dedupeKey({ user_id: "u1", kind: "credits_order_delivered", payload: { ref: order, cad_credits: 1 } });
    const c = dedupeKey({ user_id: "u1", kind: "credits_order_delivered", payload: { ref: "other" } });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(dedupeKey({ user_id: "u1", kind: "first_project", payload: {} })).toBeNull();
  });
});

describe("normaliseLocale", () => {
  it("only ar is Arabic", () => {
    expect(normaliseLocale("ar")).toBe("ar");
    expect(normaliseLocale("en")).toBe("en");
    expect(normaliseLocale("fr")).toBe("en");
    expect(normaliseLocale(null)).toBe("en");
  });
});

describe("order status kinds (0053)", () => {
  const order = (over: Partial<OutboxRow> = {}) => row({ kind: "order_shipped", payload: { ref: "ord1", order_id: "ord1" }, ...over });

  it("are outbox kinds and transactional; credit kinds are not", () => {
    for (const k of ORDER_KINDS) {
      expect(OUTBOX_KINDS).toContain(k);
      expect(isTransactional(k)).toBe(true);
    }
    expect(isTransactional("discount_ready")).toBe(false);
    expect(isTransactional("nope")).toBe(false);
  });

  it("send without an unsubscribe token and ignore the per-kind / all opt-out", () => {
    expect(decide(order(), allOn, null)).toBe("send");
    expect(decide(order(), allOn, prefs({ token: null }))).toBe("send");
    expect(decide(order(), allOn, prefs({ all_off: true, unsubscribed_kinds: ["order_shipped"] }))).toBe("send");
  });

  it("still need an email and respect the owner switch", () => {
    expect(decide(order({ email: null }), allOn, null)).toEqual({ skip: "no_email" });
    expect(decide(order(), kindSettings({ order_shipped: false }), null)).toEqual({ skip: "disabled" });
  });
});

describe("discountWindow (30 days from the EARN day)", () => {
  const now = new Date("2026-10-20T12:00:00Z");

  it("uses valid_until (a Qatar day counts to its end)", () => {
    const w = discountWindow({ earned_at: "2026-10-01", valid_until: "2026-10-31" }, now);
    expect(w.validUntil).toBe("2026-10-31T20:59:59.000Z");
    expect(w.earnedAt).toBe("2026-09-30T21:00:00.000Z");
    expect(w.expired).toBe(false);
  });

  it("derives valid_until = earned_at + 30 days when the payload has none", () => {
    const w = discountWindow({ earned_at: "2026-09-01T08:00:00Z" }, now);
    expect(w.validUntil).toBe("2026-10-01T08:00:00.000Z");
    expect(w.expired).toBe(true);
  });

  it("no dates → nothing expired, nothing to show", () => {
    expect(discountWindow({}, now)).toEqual({ earnedAt: null, validUntil: null, expired: false });
    expect(discountWindow(null, now)).toEqual({ earnedAt: null, validUntil: null, expired: false });
    expect(discountWindow({ valid_until: "nonsense" }, now).validUntil).toBeNull();
  });

  it("decide skips an expired discount_ready (never emails a closed window)", () => {
    const r = row({ kind: "discount_ready", payload: { ref: "s1", earned_at: "2026-09-01", valid_until: "2026-10-01" } });
    expect(decide(r, allOn, prefs(), now)).toEqual({ skip: "expired" });
    const open = row({ kind: "discount_ready", payload: { ref: "s2", earned_at: "2026-10-10", valid_until: "2026-11-09" } });
    expect(decide(open, allOn, prefs(), now)).toBe("send");
  });
});

import { describe, expect, it } from "vitest";
import {
  DEFAULT_KIND_SETTINGS,
  decide,
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

  it("discount_ready is disabled by default (missing setting)", () => {
    expect(decide(row({ kind: "discount_ready" }), kindSettings(null), prefs())).toEqual({ skip: "disabled" });
    expect(decide(row({ kind: "discount_ready" }), kindSettings({}), prefs())).toEqual({ skip: "disabled" });
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
    expect(s.discount_ready).toBe(false);
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

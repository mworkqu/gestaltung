// The eight cron routes after the lib/cron refactor: same auth answers, same
// status codes and bodies, same cache purges, the same lib functions called
// with the same arguments. Every job's lib is mocked: nothing touches
// Supabase, Resend, Google or a supplier.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  db: { tag: "service-db" } as unknown,
  createServiceClient: vi.fn(),
  revalidateTag: vi.fn(),
  getContactPhone: vi.fn(async () => ({})),
  runApiRefresh: vi.fn(),
  runVoltaatSync: vi.fn(),
  runDeliveryPromiseReview: vi.fn(),
  runAnonymousCleanup: vi.fn(),
  drainOutboxWith: vi.fn(),
  runRetirementsWith: vi.fn(),
  runPaymentsCron: vi.fn(),
  runMonitoringAlerts: vi.fn(),
  sendWeeklyProgressEmails: vi.fn(),
}));

vi.mock("next/cache", async (orig) => ({ ...(await orig<typeof import("next/cache")>()), revalidateTag: m.revalidateTag }));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: m.createServiceClient }));
vi.mock("@/lib/contact-phone-server", () => ({ getContactPhone: m.getContactPhone }));
vi.mock("@/lib/sourcing/api-refresh", () => ({ runApiRefresh: m.runApiRefresh }));
vi.mock("@/lib/sourcing/voltaat-sync", () => ({ runVoltaatSync: m.runVoltaatSync }));
vi.mock("@/lib/cron/delivery-promises", () => ({ runDeliveryPromiseReview: m.runDeliveryPromiseReview }));
vi.mock("@/lib/cron/anonymous-cleanup", () => ({ runAnonymousCleanup: m.runAnonymousCleanup }));
vi.mock("@/lib/notifications/drain-core", () => ({ drainOutboxWith: m.drainOutboxWith }));
vi.mock("@/lib/integrations/youtube-retire-core", () => ({ runRetirementsWith: m.runRetirementsWith }));
vi.mock("@/lib/cad-champions/payments/server", () => ({ runPaymentsCron: m.runPaymentsCron }));
vi.mock("@/lib/cad-champions/monitoring/alerts-server", () => ({ runMonitoringAlerts: m.runMonitoringAlerts }));
vi.mock("@/lib/cad-champions/training/weekly-email", () => ({ sendWeeklyProgressEmails: m.sendWeeklyProgressEmails }));

import { GET as anonymousCleanup } from "@/app/api/cron/anonymous-cleanup/route";
import { GET as ccPayments } from "@/app/api/cron/cc-payments-expire/route";
import { GET as ccWeekly } from "@/app/api/cron/cc-weekly-progress/route";
import { GET as deliveryPromises } from "@/app/api/cron/delivery-promises/route";
import { GET as notifications } from "@/app/api/cron/notifications/route";
import { GET as supplierRefresh } from "@/app/api/cron/supplier-refresh/route";
import { GET as voltaatSync } from "@/app/api/cron/voltaat-sync/route";
import { GET as youtubeRetire } from "@/app/api/cron/youtube-retire/route";

const SECRET = "cron-secret-for-tests";
const ORIGIN = "https://gestaltung360.com";
const req = (path: string, auth: string | null = `Bearer ${SECRET}`) =>
  new Request(`${ORIGIN}/api/cron/${path}`, { headers: auth ? { authorization: auth } : {} });

const STD = [
  ["supplier-refresh", supplierRefresh],
  ["voltaat-sync", voltaatSync],
  ["delivery-promises", deliveryPromises],
  ["notifications", notifications],
  ["anonymous-cleanup", anonymousCleanup],
  ["youtube-retire", youtubeRetire],
] as const;
const WITH_DB = STD.filter(([n]) => n !== "youtube-retire");
const CC = [
  ["cc-payments-expire", ccPayments],
  ["cc-weekly-progress", ccWeekly],
] as const;

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", SECRET);
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", ORIGIN);
  for (const f of Object.values(m)) if (typeof f === "function" && "mockReset" in f) (f as ReturnType<typeof vi.fn>).mockReset();
  m.createServiceClient.mockReturnValue(m.db);
  m.getContactPhone.mockResolvedValue({});
});
afterEach(() => vi.unstubAllEnvs());

describe("cron route auth (unchanged)", () => {
  it.each(STD)("%s: 401 {error: unauthorized} without, with a wrong or with an unset secret", async (_n, GET) => {
    for (const r of [req(_n, null), req(_n, "Bearer nope")]) {
      const res = await GET(r);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "unauthorized" });
    }
    vi.stubEnv("CRON_SECRET", "");
    expect((await GET(req(_n, "Bearer "))).status).toBe(401);
    expect(m.createServiceClient).not.toHaveBeenCalled();
  });

  it.each(CC)("%s: 500 cron_secret_unset when unset, empty 401 when wrong", async (_n, GET) => {
    const bad = await GET(req(_n, "Bearer nope"));
    expect(bad.status).toBe(401);
    expect(await bad.text()).toBe("");
    vi.stubEnv("CRON_SECRET", "");
    const unset = await GET(req(_n));
    expect(unset.status).toBe(500);
    expect(await unset.json()).toEqual({ error: "cron_secret_unset" });
  });

  it.each(WITH_DB)("%s: 500 no_service_key without the service key", async (_n, GET) => {
    m.createServiceClient.mockReturnValue(null);
    const res = await GET(req(_n));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "no_service_key" });
  });
});

describe("cron route results (unchanged)", () => {
  it("supplier-refresh: runs the refresh and purges only the moved products", async () => {
    m.runApiRefresh.mockResolvedValue({ checked: 3, storefront: { skus: ["DK-1", "MS-2"], listingChanged: true } });
    const res = await supplierRefresh(req("supplier-refresh"));
    expect(m.runApiRefresh).toHaveBeenCalledWith(m.db, "cron");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      checked: 3,
      storefront: { skus: ["DK-1", "MS-2"], listingChanged: true },
      purged: ["parts-listing", "part-DK-1", "part-MS-2"],
    });
    expect(m.revalidateTag.mock.calls.map((c) => c[0])).toEqual(["parts-listing", "part-DK-1", "part-MS-2"]);
  });

  it("voltaat-sync: nothing moved -> no purge, empty list", async () => {
    m.runVoltaatSync.mockResolvedValue({ status: "ok", storefront: { skus: [], listingChanged: false } });
    const res = await voltaatSync(req("voltaat-sync"));
    expect(m.runVoltaatSync).toHaveBeenCalledWith(m.db, "cron");
    expect(await res.json()).toEqual({ status: "ok", storefront: { skus: [], listingChanged: false }, purged: [] });
    expect(m.revalidateTag).not.toHaveBeenCalled();
  });

  it("delivery-promises: answers {checked, affected}", async () => {
    m.runDeliveryPromiseReview.mockResolvedValue({ checked: 2, affected: ["#a1 sent"] });
    const res = await deliveryPromises(req("delivery-promises"));
    expect(m.runDeliveryPromiseReview).toHaveBeenCalledWith(m.db);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ checked: 2, affected: ["#a1 sent"] });
  });

  it("notifications: drains 50 with the site URL and the cached contact number; errors stay 500", async () => {
    m.drainOutboxWith.mockResolvedValue({ ok: true, summary: { claimed: 1, sent: 1, failed: 0, skipped: 0, reasons: {} } });
    const ok = await notifications(req("notifications"));
    expect(m.drainOutboxWith).toHaveBeenCalledWith(m.db, ORIGIN, 50, m.getContactPhone);
    expect(await ok.json()).toEqual({ claimed: 1, sent: 1, failed: 0, skipped: 0, reasons: {} });
    m.drainOutboxWith.mockResolvedValue({ ok: false, error: "claim_failed", detail: "x" });
    const bad = await notifications(req("notifications"));
    expect(bad.status).toBe(500);
    expect(await bad.json()).toEqual({ error: "claim_failed", detail: "x" });
  });

  it("anonymous-cleanup: passes the job's status and body through", async () => {
    m.runAnonymousCleanup.mockResolvedValue({ status: 500, body: { error: "run_0055" } });
    const res = await anonymousCleanup(req("anonymous-cleanup"));
    expect(m.runAnonymousCleanup).toHaveBeenCalledWith(m.db);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "run_0055" });
  });

  it("youtube-retire: runs the retire log and purges the whole storefront when links changed", async () => {
    m.runRetirementsWith.mockImplementation(async (_o: unknown, changed: () => unknown) => {
      await changed();
      return { deleted: 1, failed: 0, skipped: 0 };
    });
    const res = await youtubeRetire(req("youtube-retire"));
    expect(m.runRetirementsWith.mock.calls[0]![0]).toEqual({});
    expect(await res.json()).toEqual({ deleted: 1, failed: 0, skipped: 0 });
    expect(m.revalidateTag.mock.calls.map((c) => c[0])).toEqual(["parts", "store-settings"]);
  });

  it("cc-payments-expire: payments then monitoring; an error is a 500 with both", async () => {
    m.runMonitoringAlerts.mockResolvedValue({ sent: false });
    m.runPaymentsCron.mockResolvedValue({ expired: 1, reminders7d: 0, reminders1d: 0, enrollmentsEnded: 0 });
    const ok = await ccPayments(req("cc-payments-expire"));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ expired: 1, reminders7d: 0, reminders1d: 0, enrollmentsEnded: 0, monitoring: { sent: false } });
    m.runPaymentsCron.mockResolvedValue({ error: "run_0084" });
    const bad = await ccPayments(req("cc-payments-expire"));
    expect(bad.status).toBe(500);
    expect(await bad.json()).toEqual({ error: "run_0084", monitoring: { sent: false } });
  });

  it("cc-weekly-progress: result or 500 with the error", async () => {
    m.sendWeeklyProgressEmails.mockResolvedValue({ sent: 4 });
    expect(await (await ccWeekly(req("cc-weekly-progress"))).json()).toEqual({ sent: 4 });
    m.sendWeeklyProgressEmails.mockResolvedValue({ error: "not_configured" });
    const bad = await ccWeekly(req("cc-weekly-progress"));
    expect(bad.status).toBe(500);
    expect(await bad.json()).toEqual({ error: "not_configured" });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CONSENT_COOKIE, CONSENT_STORAGE_KEY, serializeConsent } from "@/lib/analytics/consent";
import { cleanParams, track } from "@/lib/analytics";

type FakeWindow = {
  localStorage: { getItem: (k: string) => string | null };
  gtag?: (...args: unknown[]) => void;
};

let store: Record<string, string>;
let cookie: string;
let win: FakeWindow;

function install(extra: Partial<FakeWindow> = {}) {
  win = {
    localStorage: { getItem: (k) => (k in store ? store[k] : null) },
    ...extra,
  };
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", {
    get cookie() {
      return cookie;
    },
  });
}

beforeEach(() => {
  store = {};
  cookie = "";
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const accept = () => {
  store[CONSENT_STORAGE_KEY] = serializeConsent("accepted", Date.now());
};

describe("track", () => {
  it("is a no-op before consent (nothing stored)", () => {
    const gtag = vi.fn();
    install({ gtag });
    track("path_chosen", { path: "shop" });
    expect(gtag).not.toHaveBeenCalled();
  });

  it("is a no-op after Decline", () => {
    const gtag = vi.fn();
    install({ gtag });
    store[CONSENT_STORAGE_KEY] = serializeConsent("declined", Date.now());
    track("path_chosen", { path: "shop" });
    expect(gtag).not.toHaveBeenCalled();
  });

  it("is a no-op when gtag is missing, even after Accept", () => {
    install();
    accept();
    expect(() => track("pricing_viewed")).not.toThrow();
  });

  it("is a no-op on the server (no window)", () => {
    vi.unstubAllGlobals();
    expect(() => track("pricing_viewed")).not.toThrow();
  });

  it("calls gtag after Accept", () => {
    const gtag = vi.fn();
    install({ gtag });
    accept();
    track("add_to_cart", { sku: "ESP32-01", qty: 2 });
    expect(gtag).toHaveBeenCalledWith("event", "add_to_cart", { sku: "ESP32-01", qty: 2 });
  });

  it("sends the kit attach-rate events (P3-06) with their scalar params", () => {
    const gtag = vi.fn();
    install({ gtag });
    accept();
    track("kit_added", { lines: 7, total_qar: 142.5 });
    track("upsell_added", { sku: "VLT-1", where: "bom" });
    expect(gtag).toHaveBeenCalledWith("event", "kit_added", { lines: 7, total_qar: 142.5 });
    expect(gtag).toHaveBeenCalledWith("event", "upsell_added", { sku: "VLT-1", where: "bom" });
  });

  it("notices a later Accept without a reload, and a cookie alone is enough", () => {
    const gtag = vi.fn();
    install({ gtag });
    track("cad_generated");
    expect(gtag).not.toHaveBeenCalled();
    cookie = `other=1; ${CONSENT_COOKIE}=${serializeConsent("accepted", Date.now())}`;
    track("cad_generated");
    expect(gtag).toHaveBeenCalledWith("event", "cad_generated", {});
  });

  it("never throws when gtag throws", () => {
    install({
      gtag: () => {
        throw new Error("boom");
      },
    });
    accept();
    expect(() => track("order_placed", { order_id: "a", total_qar: 10, method: "cod" })).not.toThrow();
  });

  it("never throws when storage throws", () => {
    install({ gtag: vi.fn() });
    win.localStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
    };
    expect(() => track("pricing_viewed")).not.toThrow();
  });

  it("drops non-scalar params before sending", () => {
    const gtag = vi.fn();
    install({ gtag });
    accept();
    track("pricing_viewed", { plan: "maker", nested: { a: 1 }, list: [1, 2], nothing: null } as never);
    expect(gtag).toHaveBeenCalledWith("event", "pricing_viewed", { plan: "maker" });
  });
});

describe("cleanParams", () => {
  it("keeps strings, finite numbers and booleans", () => {
    expect(cleanParams({ a: "x", b: 2, c: true })).toEqual({ a: "x", b: 2, c: true });
  });

  it("drops objects, arrays, functions, null, undefined, NaN and Infinity", () => {
    expect(
      cleanParams({ o: {}, l: [], f: () => 1, n: null, u: undefined, nan: Number.NaN, inf: Infinity, ok: 1 })
    ).toEqual({ ok: 1 });
  });

  it("cuts long strings to 100 characters", () => {
    expect((cleanParams({ s: "a".repeat(500) }).s as string).length).toBe(100);
  });

  it("limits the number of params and tolerates junk input", () => {
    const many = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`k${i}`, i]));
    expect(Object.keys(cleanParams(many)).length).toBe(10);
    expect(cleanParams(undefined)).toEqual({});
    expect(cleanParams("text")).toEqual({});
    expect(cleanParams([1, 2])).toEqual({});
  });
});

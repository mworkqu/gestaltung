import { describe, expect, it } from "vitest";

import { buildStoreImageRequest, internalBaseUrl } from "@/lib/store/store-image";

describe("store-image request", () => {
  it("base url: site url, else VERCEL_URL, else localhost", () => {
    expect(internalBaseUrl({ NEXT_PUBLIC_SITE_URL: "https://a.com", VERCEL_URL: "b.vercel.app" })).toBe("https://a.com");
    expect(internalBaseUrl({ VERCEL_URL: "b.vercel.app" })).toBe("https://b.vercel.app");
    expect(internalBaseUrl({})).toBe("http://localhost:3000");
  });
  it("secret: INTERNAL_API_SECRET, else CRON_SECRET, else no request", () => {
    const buf = Buffer.from("x");
    expect(buildStoreImageRequest(buf, "k", { INTERNAL_API_SECRET: "i", CRON_SECRET: "c" })?.init.headers["x-internal-secret"]).toBe("i");
    expect(buildStoreImageRequest(buf, "k", { CRON_SECRET: "c" })?.init.headers["x-internal-secret"]).toBe("c");
    expect(buildStoreImageRequest(buf, "k", {})).toBeNull();
  });
  it("builds the url and body", () => {
    const r = buildStoreImageRequest(Buffer.from("hi"), "supplier/x/1", { CRON_SECRET: "c", NEXT_PUBLIC_SITE_URL: "https://a.com/" })!;
    expect(r.url).toBe("https://a.com/api/admin/store-image");
    expect(JSON.parse(r.init.body)).toEqual({ dataBase64: "aGk=", key: "supplier/x/1" });
  });
});

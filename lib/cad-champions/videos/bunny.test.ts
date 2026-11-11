import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { BUNNY_TTL_SECONDS, bunnyConfig, bunnyToken, signBunnyEmbed } from "./bunny";

const GUID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const config = { libraryId: "12345", tokenKey: "secret-key", host: "iframe.mediadelivery.net" };

describe("bunny", () => {
  it("is off without a library id and token key", () => {
    expect(bunnyConfig({})).toBeNull();
    expect(bunnyConfig({ BUNNY_LIBRARY_ID: "abc", BUNNY_TOKEN_KEY: "k" })).toBeNull();
    expect(bunnyConfig({ BUNNY_LIBRARY_ID: "12345", BUNNY_TOKEN_KEY: "k" })).toEqual({ libraryId: "12345", tokenKey: "k", host: "iframe.mediadelivery.net" });
    expect(bunnyConfig({ BUNNY_LIBRARY_ID: "1", BUNNY_TOKEN_KEY: "k", BUNNY_CDN_HOST: "https://video.example.com/" })?.host).toBe("video.example.com");
  });

  it("signs SHA256(token key + video id + expires) for 2 hours", () => {
    const now = Date.UTC(2026, 9, 14, 12);
    const signed = signBunnyEmbed(GUID, { now, config });
    const expires = Math.floor(now / 1000) + BUNNY_TTL_SECONDS;
    expect(signed?.expires).toBe(expires);
    const want = createHash("sha256").update(`secret-key${GUID}${expires}`).digest("hex");
    expect(bunnyToken("secret-key", GUID, expires)).toBe(want);
    const url = new URL(signed!.url);
    expect(url.origin + url.pathname).toBe(`https://iframe.mediadelivery.net/embed/12345/${GUID}`);
    expect(url.searchParams.get("token")).toBe(want);
    expect(url.searchParams.get("expires")).toBe(String(expires));
    expect(signed!.url).not.toContain("secret-key");
  });

  it("refuses bad ids and missing config", () => {
    expect(signBunnyEmbed("../x", { config })).toBeNull();
    expect(signBunnyEmbed(GUID, { config: null })).toBeNull();
  });
});

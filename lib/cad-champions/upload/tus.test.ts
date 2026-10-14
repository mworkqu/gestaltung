import { describe, expect, it } from "vitest";

import { buildTusOptions } from "./tus";

describe("buildTusOptions", () => {
  const opts = buildTusOptions({
    bucket: "cc-submissions",
    objectName: "u1/practice/1_cube.step",
    contentType: "application/step",
    accessToken: "tok",
    supabaseUrl: "https://example.supabase.co/",
    anonKey: "anon",
  });

  it("targets the Supabase resumable endpoint with the user's token", () => {
    expect(opts.endpoint).toBe("https://example.supabase.co/storage/v1/upload/resumable");
    expect(opts.headers).toEqual({ authorization: "Bearer tok", apikey: "anon", "x-upsert": "false" });
  });

  it("uses 6 MB chunks and passes bucket + object metadata", () => {
    expect(opts.chunkSize).toBe(6 * 1024 * 1024);
    expect(opts.metadata).toMatchObject({ bucketName: "cc-submissions", objectName: "u1/practice/1_cube.step" });
    expect(opts.removeFingerprintOnSuccess).toBe(true);
  });
});

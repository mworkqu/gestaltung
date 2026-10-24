import { describe, expect, it } from "vitest";

import { CAD_BUCKET, QUOTE_BUCKET } from "@/lib/design/constants";
import { isAllowedQuoteStoragePath } from "@/lib/design/quote-paths";

const UID = "11111111-2222-4333-8444-555555555555";
const OTHER = "99999999-2222-4333-8444-555555555555";
const PROJECT = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const FILE = "0f0f0f0f-1111-4222-8333-444444444444";

describe("isAllowedQuoteStoragePath: quote-uploads", () => {
  it("accepts the uploader's <uuid>/<name> shape, with or without a session", () => {
    expect(isAllowedQuoteStoragePath(QUOTE_BUCKET, `${FILE}/bracket_v2.step`, null)).toBe(true);
    expect(isAllowedQuoteStoragePath(QUOTE_BUCKET, `${FILE}/part-1.STL`, UID)).toBe(true);
  });

  it("rejects traversal, encoding, backslashes, absolute and control characters", () => {
    for (const bad of [
      "../x",
      `${FILE}/../x.stl`,
      `${FILE}/..`,
      `a/%2e%2e/b`,
      `${FILE}/%2e%2e%2fx.stl`,
      `${FILE}\\x.stl`,
      `\\\\${FILE}/x.stl`,
      `/${FILE}/x.stl`,
      `${FILE}/x\u0000.stl`,
      `${FILE}/x\n.stl`,
      `${FILE}//x.stl`,
      `${FILE}/./x.stl`,
    ]) {
      expect(isAllowedQuoteStoragePath(QUOTE_BUCKET, bad, null), JSON.stringify(bad)).toBe(false);
    }
  });

  it("rejects other shapes: another bucket's path, wrong depth, non-uuid folder", () => {
    expect(isAllowedQuoteStoragePath(QUOTE_BUCKET, `${UID}/${PROJECT}/${FILE}-x.stl`, UID)).toBe(false);
    expect(isAllowedQuoteStoragePath(QUOTE_BUCKET, "payment-proofs/x.png", null)).toBe(false);
    expect(isAllowedQuoteStoragePath(QUOTE_BUCKET, "x.stl", null)).toBe(false);
    expect(isAllowedQuoteStoragePath(QUOTE_BUCKET, `${FILE}/a b.stl`, null)).toBe(false);
  });

  it("rejects non-strings, empty and over-long paths", () => {
    expect(isAllowedQuoteStoragePath(QUOTE_BUCKET, null, null)).toBe(false);
    expect(isAllowedQuoteStoragePath(QUOTE_BUCKET, "", null)).toBe(false);
    expect(isAllowedQuoteStoragePath(QUOTE_BUCKET, `${FILE}/${"a".repeat(400)}`, null)).toBe(false);
  });

  it("rejects an unknown bucket", () => {
    expect(isAllowedQuoteStoragePath("payment-proofs", `${FILE}/x.png`, UID)).toBe(false);
    expect(isAllowedQuoteStoragePath("", `${FILE}/x.png`, UID)).toBe(false);
  });
});

describe("isAllowedQuoteStoragePath: cad-files", () => {
  const good = `${UID}/${PROJECT}/${FILE}-bracket.step`;

  it("accepts <user>/<project>/<uuid>-<name> for that user", () => {
    expect(isAllowedQuoteStoragePath(CAD_BUCKET, good, UID)).toBe(true);
    expect(isAllowedQuoteStoragePath(CAD_BUCKET, good, UID.toUpperCase())).toBe(true);
  });

  it("needs a session", () => {
    expect(isAllowedQuoteStoragePath(CAD_BUCKET, good, null)).toBe(false);
  });

  it("rejects another user's folder", () => {
    expect(isAllowedQuoteStoragePath(CAD_BUCKET, good, OTHER)).toBe(false);
    expect(isAllowedQuoteStoragePath(CAD_BUCKET, `${OTHER}/${PROJECT}/${FILE}-x.step`, UID)).toBe(false);
  });

  it("rejects traversal into another folder or bucket", () => {
    for (const bad of [
      `${UID}/../${OTHER}/${PROJECT}/${FILE}-x.step`,
      `${UID}/${PROJECT}/../../payment-proofs/${UID}/x.png`,
      `../payment-proofs/${UID}/x.png`,
      `${UID}/%2e%2e/${OTHER}/x`,
      `${UID}/${PROJECT}/${FILE}-x\\..\\y.step`,
      `/${good}`,
    ]) {
      expect(isAllowedQuoteStoragePath(CAD_BUCKET, bad, UID), bad).toBe(false);
    }
  });

  it("rejects the quote-uploads shape and missing segments", () => {
    expect(isAllowedQuoteStoragePath(CAD_BUCKET, `${FILE}/x.stl`, UID)).toBe(false);
    expect(isAllowedQuoteStoragePath(CAD_BUCKET, `${UID}/${PROJECT}/x.stl`, UID)).toBe(false);
  });
});

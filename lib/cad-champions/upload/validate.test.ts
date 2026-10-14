import { describe, expect, it } from "vitest";

import {
  DEFAULT_MAX_BYTES,
  acceptAttribute,
  buildObjectPath,
  chooseUploadMethod,
  contentTypeFor,
  fileExtension,
  isPathUnderPrefix,
  isStepHeader,
  safeFileName,
  validateFileMeta,
  validateHeader,
} from "./validate";

const enc = (s: string) => new TextEncoder().encode(s);

describe("fileExtension", () => {
  it("returns the lower-case extension", () => {
    expect(fileExtension("Cube.STEP")).toBe(".step");
    expect(fileExtension("a.b.stp")).toBe(".stp");
    expect(fileExtension("C:\\x\\part.Pdf")).toBe(".pdf");
  });
  it("returns empty for no extension, dotfiles and trailing dots", () => {
    expect(fileExtension("README")).toBe("");
    expect(fileExtension(".step")).toBe("");
    expect(fileExtension("file.")).toBe("");
  });
});

describe("validateFileMeta", () => {
  it("accepts .step and .stp", () => {
    expect(validateFileMeta({ name: "cube.step", size: 10 }, "step")).toEqual({ ok: true });
    expect(validateFileMeta({ name: "cube.STP", size: 10 }, "step")).toEqual({ ok: true });
  });
  it("rejects a wrong extension and reports it", () => {
    expect(validateFileMeta({ name: "drawing.pdf", size: 10 }, "step")).toEqual({
      ok: false,
      code: "wrong_extension",
      extension: ".pdf",
    });
  });
  it("rejects an empty file", () => {
    expect(validateFileMeta({ name: "cube.step", size: 0 }, "step")).toMatchObject({ ok: false, code: "empty" });
  });
  it("rejects a file over the limit (50 MB by default)", () => {
    expect(validateFileMeta({ name: "big.step", size: DEFAULT_MAX_BYTES + 1 }, "step")).toMatchObject({
      ok: false,
      code: "too_large",
      maxBytes: DEFAULT_MAX_BYTES,
    });
    expect(validateFileMeta({ name: "ok.step", size: DEFAULT_MAX_BYTES }, "step")).toEqual({ ok: true });
    expect(validateFileMeta({ name: "x.pdf", size: 11 }, "pdf", 10)).toMatchObject({ code: "too_large" });
  });
  it("knows every accept kind", () => {
    expect(validateFileMeta({ name: "a.jpeg", size: 1 }, "image").ok).toBe(true);
    expect(validateFileMeta({ name: "a.webm", size: 1 }, "video").ok).toBe(true);
    expect(validateFileMeta({ name: "a.zip", size: 1 }, "zip").ok).toBe(true);
    expect(acceptAttribute("step")).toBe(".step,.stp");
  });
});

describe("STEP header", () => {
  it("accepts ISO-10303-21 at the start", () => {
    expect(isStepHeader(enc("ISO-10303-21;\nHEADER;"))).toBe(true);
  });
  it("allows a BOM and leading whitespace", () => {
    expect(isStepHeader(new Uint8Array([0xef, 0xbb, 0xbf, ...enc("ISO-10303-21;")]))).toBe(true);
    expect(isStepHeader(enc("\r\n  ISO-10303-21;"))).toBe(true);
  });
  it("rejects a PDF renamed to .step, and short or wrong text", () => {
    expect(isStepHeader(enc("%PDF-1.7\n"))).toBe(false);
    expect(isStepHeader(enc("ISO-10303"))).toBe(false);
    expect(isStepHeader(enc("iso-10303-21;"))).toBe(false);
  });
  it("validateHeader maps to error codes", () => {
    expect(validateHeader(new Uint8Array(), "step")).toMatchObject({ code: "empty" });
    expect(validateHeader(enc("%PDF"), "step")).toMatchObject({ code: "not_step" });
    expect(validateHeader(enc("%PDF"), "pdf")).toEqual({ ok: true });
  });
});

describe("paths", () => {
  it("makes safe file names and keeps the (lower-case) extension", () => {
    expect(safeFileName("My Cube (v2).STEP")).toBe("My_Cube_v2.step");
    expect(safeFileName("../../etc/passwd")).toBe("passwd");
    expect(safeFileName("مكعب.step")).toBe("file.step");
    expect(safeFileName("a".repeat(300) + ".stp").length).toBeLessThanOrEqual(100);
  });
  it("builds a timestamped object path under the prefix", () => {
    expect(buildObjectPath("u1/practice/", "cube.step", 123)).toBe("u1/practice/123_cube.step");
    expect(buildObjectPath("u1/practice", "cube.step", 123)).toBe("u1/practice/123_cube.step");
  });
  it("accepts only plain paths under the prefix", () => {
    expect(isPathUnderPrefix("u1/practice/1_a.step", "u1/practice/")).toBe(true);
    expect(isPathUnderPrefix("u1/practice/", "u1/practice/")).toBe(false);
    expect(isPathUnderPrefix("u2/practice/1_a.step", "u1/practice/")).toBe(false);
    expect(isPathUnderPrefix("u1/practice/../../u2/x.step", "u1/practice/")).toBe(false);
    expect(isPathUnderPrefix("u1/practice//x.step", "u1/practice/")).toBe(false);
    expect(isPathUnderPrefix(42, "u1/")).toBe(false);
  });
});

describe("upload method and content type", () => {
  it("uses TUS above 6 MB", () => {
    expect(chooseUploadMethod(6 * 1024 * 1024)).toBe("standard");
    expect(chooseUploadMethod(6 * 1024 * 1024 + 1)).toBe("resumable");
  });
  it("sends a type the bucket accepts", () => {
    expect(contentTypeFor("a.stp", "step")).toBe("application/step");
    expect(contentTypeFor("a.pdf", "pdf")).toBe("application/pdf");
    expect(contentTypeFor("a.JPG", "image")).toBe("image/jpeg");
  });
});

import { describe, expect, it } from "vitest";

import { attachmentExt, checkDrawingAttachment, isPdfPath } from "./drawing-attachment";

const MB = 1024 * 1024;

describe("checkDrawingAttachment", () => {
  it("accepts images and PDFs up to 20 MB", () => {
    expect(checkDrawingAttachment({ name: "a.jpg", type: "image/jpeg", size: 5 * MB })).toBe("ok");
    expect(checkDrawingAttachment({ name: "a.PDF", type: "", size: 20 * MB })).toBe("ok");
    expect(checkDrawingAttachment({ name: "sketch.heic", type: "", size: MB })).toBe("ok");
  });
  it("rejects other types and anything over 20 MB", () => {
    expect(checkDrawingAttachment({ name: "a.exe", type: "application/x-msdownload", size: MB })).toBe("type");
    expect(checkDrawingAttachment({ name: "a.png", type: "image/png", size: 20 * MB + 1 })).toBe("size");
  });
  it("reads extensions", () => {
    expect(attachmentExt("x/y/abc.PDF")).toBe("pdf");
    expect(attachmentExt("noext")).toBe("");
    expect(isPdfPath("u/p/1.pdf")).toBe(true);
    expect(isPdfPath("u/p/1.png")).toBe(false);
  });
});

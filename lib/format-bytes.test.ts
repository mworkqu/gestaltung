import { describe, expect, it } from "vitest";

import { formatFileSize } from "./format-bytes";

describe("formatFileSize", () => {
  it("uses B, KB, MB with correct maths", () => {
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(1024)).toBe("1 KB");
    expect(formatFileSize(43520)).toBe("42.5 KB");
    expect(formatFileSize(3355443)).toBe("3.2 MB");
    expect(formatFileSize(150 * 1024)).toBe("150 KB");
    expect(formatFileSize(50 * 1024 * 1024)).toBe("50 MB");
  });
  it("never prints 0.00 MB for a small file", () => {
    expect(formatFileSize(2048)).toBe("2 KB");
    expect(formatFileSize(2048)).not.toContain("0.00");
  });
  it("rolls over instead of printing 1000 KB", () => {
    expect(formatFileSize(1023.9 * 1024)).toBe("1 MB");
  });
  it("is empty for missing or bad input", () => {
    for (const v of [0, -5, NaN, undefined, null]) expect(formatFileSize(v as number | null | undefined)).toBe("");
  });
});

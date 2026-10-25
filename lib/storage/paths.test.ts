import { describe, expect, it } from "vitest";

import { CAD_BUCKET, QUOTE_BUCKET } from "@/lib/design/constants";
import { ENGINEERING_BUCKET } from "@/lib/engineering/config";
import { PROJECT_IMAGE_BUCKET } from "@/lib/projects/constants";
import { BUCKETS, safeFileName, userPath } from "@/lib/storage/paths";
import { VIDEO_BUCKET } from "@/lib/videos";

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

describe("BUCKETS", () => {
  it("agrees with the existing constants", () => {
    expect(BUCKETS.cadFiles).toBe(CAD_BUCKET);
    expect(BUCKETS.quoteUploads).toBe(QUOTE_BUCKET);
    expect(BUCKETS.projectImages).toBe(PROJECT_IMAGE_BUCKET);
    expect(BUCKETS.engineeringFiles).toBe(ENGINEERING_BUCKET);
    expect(BUCKETS.videos).toBe(VIDEO_BUCKET);
  });

  it("every id is created by a migration", () => {
    const dir = join(process.cwd(), "supabase/migrations");
    const sql = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => readFileSync(join(dir, f), "utf8"))
      .join("\n");
    for (const id of Object.values(BUCKETS)) {
      expect(sql, id).toMatch(new RegExp(`'${id}'`));
    }
  });
});

describe("safeFileName", () => {
  it("keeps safe names unchanged", () => {
    expect(safeFileName("bracket-v2_final.stl")).toBe("bracket-v2_final.stl");
  });

  it("replaces unsafe characters and collapses runs", () => {
    expect(safeFileName("my part (1).STL")).toBe("my_part_1_.STL");
    expect(safeFileName("a/b\\c%2e.stl")).toBe("a_b_c_2e.stl");
    expect(safeFileName("عربي.pdf")).toBe("_.pdf");
  });

  it("drops leading dots and dot runs so '..' cannot survive", () => {
    expect(safeFileName("../../etc/passwd")).toBe("_._etc_passwd");
    expect(safeFileName("..hidden.stl")).toBe("hidden.stl");
    expect(safeFileName("a..b.stl")).toBe("a.b.stl");
    expect(safeFileName("....")).toBe("file");
  });

  it("caps length at 80 and keeps the extension", () => {
    const out = safeFileName(`${"x".repeat(200)}.stl`);
    expect(out).toHaveLength(80);
    expect(out.endsWith(".stl")).toBe(true);
    expect(safeFileName("y".repeat(200))).toHaveLength(80);
    expect(safeFileName(`${"x".repeat(200)}.stl`, { max: 20 })).toHaveLength(20);
  });

  it("output always satisfies the store-lead print-file pattern", () => {
    const PRINT_FILE = /^[\w.-]{1,80}\.stl$/i;
    for (const n of ["Part 1.stl", `${"é".repeat(100)}.stl`, "../x.stl", "a b.c.stl"]) {
      expect(safeFileName(n, { fallback: "part.stl" })).toMatch(PRINT_FILE);
    }
  });

  it("falls back for empty results", () => {
    expect(safeFileName("")).toBe("file");
    expect(safeFileName("???")).toBe("_");
    expect(safeFileName("...", { fallback: "part.stl" })).toBe("part.stl");
  });
});

describe("userPath", () => {
  const uid = "123e4567-e89b-12d3-a456-426614174000";

  it("joins the user id and segments with /", () => {
    expect(userPath(uid, "proj", "file.stl")).toBe(`${uid}/proj/file.stl`);
    expect(userPath(uid)).toBe(uid);
    expect(userPath(uid, "print/2026-10-22", "a.stl")).toBe(`${uid}/print/2026-10-22/a.stl`);
  });

  it("rejects traversal, encoding, backslashes and empty segments", () => {
    for (const bad of ["..", ".", "", "a/../b", "a//b", "%2e%2e", "a%2fb", "a\\b", "/abs", "trail/"]) {
      expect(() => userPath(uid, bad), JSON.stringify(bad)).toThrow();
    }
    expect(() => userPath("", "x")).toThrow();
    expect(() => userPath("../x", "y")).toThrow();
    expect(() => userPath("a/b", "y")).toThrow();
  });
});

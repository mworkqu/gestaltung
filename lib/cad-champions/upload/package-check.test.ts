import { describe, expect, it } from "vitest";

import {
  PACKAGE_MAX_ENTRIES,
  RESULTS_FOLDERS,
  checkPackage,
  normalizeEntryPath,
  parseExpectations,
  patternLabel,
  taskPackageStatus,
  templateEntries,
  type ZipEntryInfo,
} from "./package-check";

const f = (name: string, size = 100): ZipEntryInfo => ({ name, uncompressedSize: size, compressedSize: size, isDirectory: false });
const d = (name: string): ZipEntryInfo => ({ name, uncompressedSize: 0, compressedSize: 0, isDirectory: true });

const ROOT = "A07/DAY 01/Results";
const allFolders = RESULTS_FOLDERS.map((x) => d(`${ROOT}/${x.name}/`));

describe("zip-slip", () => {
  it("refuses paths that escape the folder", () => {
    expect(normalizeEntryPath("../evil.sh").ok).toBe(false);
    expect(normalizeEntryPath("Results/../../x").ok).toBe(false);
    expect(normalizeEntryPath("/etc/passwd").ok).toBe(false);
    expect(normalizeEntryPath("C:/Windows/x.dll").ok).toBe(false);
    expect(normalizeEntryPath("..\\x").ok).toBe(false);
    expect(normalizeEntryPath("a\u0000b").ok).toBe(false);
    expect(normalizeEntryPath("").ok).toBe(false);
  });

  it("normalises safe paths", () => {
    expect(normalizeEntryPath("A07\\DAY 01\\Results\\PDF files\\a.pdf")).toEqual({
      ok: true,
      path: "A07/DAY 01/Results/PDF files/a.pdf",
      segments: ["A07", "DAY 01", "Results", "PDF files", "a.pdf"],
    });
    expect(normalizeEntryPath("./a//b/").ok).toBe(true);
  });
});

describe("expectations", () => {
  it("reads the full shape", () => {
    const e = parseExpectations({
      required_folders: ["parts and assemblies", "PDF files", "Nope"],
      tasks: { t1: { files: ["Parts and Assemblies/Part_03.*"] }, t2: { files: ["PDF files/*.pdf"], require_step: false } },
    });
    expect(e.requiredFolders).toEqual(["parts_and_assemblies", "pdf_files"]);
    expect(e.tasks).toEqual([
      { taskId: "t1", patterns: ["Parts and Assemblies/Part_03.*"], requireStep: true },
      { taskId: "t2", patterns: ["PDF files/*.pdf"], requireStep: false },
    ]);
  });

  it("reads the short form and defaults to all folders", () => {
    const e = parseExpectations({ t1: ["Parts and Assemblies/Part_01.*"] });
    expect(e.requiredFolders).toHaveLength(8);
    expect(e.tasks[0]).toMatchObject({ taskId: "t1", requireStep: true });
  });

  it("survives junk", () => {
    expect(parseExpectations(null).tasks).toEqual([]);
    expect(parseExpectations([1, 2]).tasks).toEqual([]);
    expect(parseExpectations({ t1: "x", t2: { files: [] } }).tasks).toEqual([]);
  });

  it("labels patterns", () => {
    expect(patternLabel("Parts and Assemblies/Part_03.*")).toBe("Part_03");
    expect(patternLabel("PDF files/*.pdf")).toBe("PDF files/*.pdf");
  });
});

describe("checkPackage", () => {
  const exp = parseExpectations({
    tasks: {
      t1: { files: ["Parts and Assemblies/Part_01.*"] },
      t3: { files: ["Parts and Assemblies/Part_03.*"] },
      t4: { files: ["PDF files/Drawing_02.pdf"] },
    },
  });

  it("passes a complete package", () => {
    const m = checkPackage(
      [
        ...allFolders,
        f(`${ROOT}/Parts and Assemblies/Part_01.step`),
        f(`${ROOT}/Parts and Assemblies/Part_01.ipt`),
        f(`${ROOT}/Parts and Assemblies/part_03.STP`),
        f(`${ROOT}/PDF files/Drawing_02.pdf`),
        f(`${ROOT}/Rendered Images/extra.png`),
        d("A07/DAY 01/Workspace/"),
        f("A07/DAY 01/Workspace/scratch.ipt"),
      ],
      exp
    );
    expect(m.ok).toBe(true);
    expect(m.root).toBe("A07/DAY 01");
    expect(m.warnings).toEqual([]);
    expect(m.folders.every((x) => x.present)).toBe(true);
    expect(m.tasks.map((t) => t.items[0].status)).toEqual(["found", "found", "found"]);
    expect(m.tasks[0].items[0].files).toHaveLength(2); // Part_01.* takes the STEP and the native file
    expect(m.unmatched).toEqual([`${ROOT}/Rendered Images/extra.png`]);
    expect(taskPackageStatus(m, "t1")).toBe("complete");
  });

  it("warns when only the native file is there", () => {
    const m = checkPackage([...allFolders, f(`${ROOT}/Parts and Assemblies/Part_03.ipt`)], exp);
    expect(m.tasks[1].items[0].status).toBe("native_only");
    expect(m.warnings).toContainEqual({ code: "no_step", taskId: "t3", label: "Part_03", exts: [".ipt"] });
    expect(m.warnings).toContainEqual({ code: "missing_file", taskId: "t1", label: "Part_01" });
    expect(taskPackageStatus(m, "t3")).toBe("partial");
    expect(taskPackageStatus(m, "t1")).toBe("missing");
    expect(taskPackageStatus(null, "t1")).toBe("none");
  });

  it("matches folders case-insensitively and without a Results folder", () => {
    const m = checkPackage(
      [f("parts and assemblies/PART_01.step"), f("pdf FILES/drawing_02.PDF"), f("Parts and Assemblies/Part_03.stp")],
      exp
    );
    expect(m.tasks.map((t) => t.items[0].status)).toEqual(["found", "found", "found"]);
    expect(m.root).toBeNull();
    expect(m.warnings.filter((w) => w.code === "missing_folder").map((w) => w.code === "missing_folder" && w.folder)).toEqual([
      "2D Drawings",
      "3D Scannings",
      "Animations",
      "Rendered Images",
      "Reports",
      "STL files",
    ]);
  });

  it("flags wrong file types and files outside Results", () => {
    const m = checkPackage(
      [...allFolders, f(`${ROOT}/PDF files/render.png`), f(`${ROOT}/notes.txt`), f("readme.txt"), f(`${ROOT}/Misc/a.step`)],
      parseExpectations({})
    );
    expect(m.warnings).toContainEqual({ code: "wrong_type", folder: "PDF files", file: `${ROOT}/PDF files/render.png`, ext: ".png" });
    expect(m.warnings).toContainEqual({ code: "outside_results", file: `${ROOT}/notes.txt` });
    expect(m.warnings).toContainEqual({ code: "outside_results", file: "readme.txt" });
    expect(m.warnings).toContainEqual({ code: "outside_results", file: `${ROOT}/Misc/a.step` });
  });

  it("warns about password-protected entries (SR-L12)", () => {
    const m = checkPackage([...allFolders, { ...f(`${ROOT}/PDF files/secret.pdf`), encrypted: true }, f(`${ROOT}/PDF files/a.pdf`)], parseExpectations({}));
    expect(m.warnings).toContainEqual({ code: "encrypted_entry", file: `${ROOT}/PDF files/secret.pdf` });
    expect(m.warnings.filter((w) => w.code === "encrypted_entry")).toHaveLength(1);
  });

  it("ignores OS junk", () => {
    const m = checkPackage([...allFolders, f("__MACOSX/._x"), f(`${ROOT}/PDF files/.DS_Store`), f(`${ROOT}/PDF files/a.pdf`)], parseExpectations({}));
    expect(m.fileCount).toBe(1);
    expect(m.warnings).toEqual([]);
  });

  it("refuses unsafe entries", () => {
    const m = checkPackage([...allFolders, f("../../evil.exe"), f(`${ROOT}/PDF files/a.pdf`)], parseExpectations({}));
    expect(m.ok).toBe(false);
    expect(m.errors).toContain("unsafe_path");
    expect(m.unsafe).toEqual(["../../evil.exe"]);
  });

  it("enforces the limits", () => {
    const many = Array.from({ length: PACKAGE_MAX_ENTRIES + 1 }, (_, i) => f(`${ROOT}/PDF files/${i}.pdf`));
    expect(checkPackage(many, parseExpectations({})).errors).toContain("too_many_files");
    const huge = [f(`${ROOT}/Animations/a.avi`, 1.5 * 1024 ** 3), f(`${ROOT}/Animations/b.avi`, 1.5 * 1024 ** 3)];
    expect(checkPackage(huge, parseExpectations({})).errors).toContain("too_large");
    expect(checkPackage([...allFolders], parseExpectations({})).errors).toContain("empty");
  });
});

describe("template", () => {
  it("lists every Results folder plus Workspace", () => {
    const t = templateEntries();
    expect(t).toContain("CODE/DAY 01/Results/Parts and Assemblies/");
    expect(t).toContain("CODE/DAY 01/Workspace/");
    expect(t.filter((x) => x.startsWith("CODE/DAY 01/Results/") && x !== "CODE/DAY 01/Results/")).toHaveLength(8);
    expect(t.every((x) => x.endsWith("/"))).toBe(true);
  });
});

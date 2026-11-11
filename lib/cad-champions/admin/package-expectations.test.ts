import { describe, expect, it } from "vitest";

import { checkPackage, parseExpectations } from "../upload/package-check";
import {
  buildExpectationsJson,
  draftFromJson,
  invalidStoredPatterns,
  normalizePattern,
  patternsFromText,
  suggestPattern,
  tasksWithExpectations,
  validatePattern,
} from "./package-expectations";

describe("validatePattern", () => {
  it("accepts folder + name globs, any folder case", () => {
    expect(validatePattern("Parts and Assemblies/Part_03.*")).toBeNull();
    expect(validatePattern("parts and assemblies/Part_03.step")).toBeNull();
    expect(validatePattern("PDF files/Drawing_0?.pdf")).toBeNull();
    expect(validatePattern("Results/Rendered Images/Render 1.png")).toBeNull();
  });

  it("refuses unsafe, folderless, unknown folders and empty names", () => {
    expect(validatePattern("")).toBe("empty");
    expect(validatePattern("../Part_03.*")).toBe("unsafe");
    expect(validatePattern("/Parts and Assemblies/x")).toBe("unsafe");
    expect(validatePattern("C:/x/y")).toBe("unsafe");
    expect(validatePattern("Part_03.*")).toBe("no_folder");
    expect(validatePattern("Models/Part_03.*")).toBe("unknown_folder");
    expect(validatePattern("Parts and Assemblies/")).toBe("no_name");
    expect(validatePattern("Parts and Assemblies/*")).toBe("no_name");
    expect(validatePattern("Parts and Assemblies/a|b")).toBe("bad_chars");
    expect(validatePattern(`Parts and Assemblies/${"a".repeat(220)}`)).toBe("too_long");
  });
});

describe("helpers", () => {
  it("normalises the folder spelling", () => {
    expect(normalizePattern(" parts AND assemblies\\Part_03.* ")).toBe("Parts and Assemblies/Part_03.*");
  });

  it("splits lines", () => {
    expect(patternsFromText("a/b\r\n\n  c/d  \n")).toEqual(["a/b", "c/d"]);
  });

  it("suggests a pattern per expected upload", () => {
    expect(suggestPattern(3, "step")).toBe("Parts and Assemblies/Part_03.*");
    expect(suggestPattern(12, "pdf")).toBe("PDF files/Drawing_12.pdf");
    expect(validatePattern(suggestPattern(1, "image"))).toBeNull();
    expect(validatePattern(suggestPattern(1, "video"))).toBeNull();
  });
});

describe("draft and build", () => {
  const ids = ["t1", "t2"];

  it("reads the short and long stored forms", () => {
    const short = draftFromJson({ t1: ["Parts and Assemblies/Part_01.*"] }, ids);
    expect(short.tasks[0]).toEqual({ taskId: "t1", patterns: ["Parts and Assemblies/Part_01.*"], requireStep: true });
    expect(short.tasks[1].patterns).toEqual([]);
    expect(short.requiredFolders).toHaveLength(8);
    const long = draftFromJson({ required_folders: ["PDF files"], tasks: { t2: { files: ["PDF files/D.pdf"], require_step: false } } }, ids);
    expect(long.requiredFolders).toEqual(["pdf_files"]);
    expect(long.tasks[1]).toMatchObject({ patterns: ["PDF files/D.pdf"], requireStep: false });
  });

  it("builds JSON the student validator reads back unchanged", () => {
    const r = buildExpectationsJson(
      {
        requiredFolders: ["parts_and_assemblies", "pdf_files"],
        tasks: [
          { taskId: "t1", patterns: ["parts and assemblies/Part_01.*", ""], requireStep: true },
          { taskId: "t2", patterns: [], requireStep: true },
        ],
      },
      ids
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.json).toEqual({
      required_folders: ["Parts and Assemblies", "PDF files"],
      tasks: { t1: { files: ["Parts and Assemblies/Part_01.*"], require_step: true } },
    });
    const parsed = parseExpectations(r.json);
    expect(parsed.requiredFolders).toEqual(["parts_and_assemblies", "pdf_files"]);
    expect(parsed.tasks).toEqual([{ taskId: "t1", patterns: ["Parts and Assemblies/Part_01.*"], requireStep: true }]);
    const manifest = checkPackage(
      [
        { name: "A01/DAY 01/Results/Parts and Assemblies/Part_01.step", uncompressedSize: 10, compressedSize: 5, isDirectory: false },
        { name: "A01/DAY 01/Results/PDF files/x.pdf", uncompressedSize: 10, compressedSize: 5, isDirectory: false },
      ],
      parsed
    );
    expect(manifest.tasks[0].items[0].status).toBe("found");
  });

  it("reports invalid, duplicate and unknown-task entries", () => {
    const r = buildExpectationsJson(
      {
        requiredFolders: [],
        tasks: [
          { taskId: "t1", patterns: ["Models/x.*", "PDF files/a.pdf", "pdf files/A.pdf"], requireStep: false },
          { taskId: "zz", patterns: ["PDF files/a.pdf"], requireStep: false },
        ],
      },
      ids
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.issues.map((i) => i.error).sort()).toEqual(["duplicate", "unknown_folder", "unknown_task"]);
  });

  it("lists tasks with expectations and invalid stored patterns", () => {
    const json = { tasks: { t1: { files: ["Parts and Assemblies/P.*"] }, t2: { files: ["Nope/x.*"] } } };
    expect([...tasksWithExpectations(json)].sort()).toEqual(["t1", "t2"]);
    expect(invalidStoredPatterns(json)).toEqual([{ taskId: "t2", pattern: "Nope/x.*", error: "unknown_folder" }]);
  });
});

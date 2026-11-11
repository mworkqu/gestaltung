import { deflateRawSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { zipStore } from "@/lib/studio/zip";

import type { ZipEntryInfo } from "../upload/package-check";
import { readZipEntries, type RangeReader } from "../upload/zip-manifest";
import { mapLimit, planGrading, readyForScoring, selectPackageSteps } from "./plan";
import { readZipEntryData } from "./zip-extract";

const tasks = [
  { id: "t1", grading_mode: "auto_step" },
  { id: "t2", grading_mode: "auto_step" },
  { id: "t3", grading_mode: "ai_drawing" },
  { id: "t4", grading_mode: "manual" },
];

describe("planGrading", () => {
  it("per_task: grades uploaded STEP files, placeholders for the rest", () => {
    const plan = planGrading({
      uploadMode: "per_task",
      tasks,
      submissions: [
        { id: "s1", task_id: "t1" },
        { id: "s3", task_id: "t3" },
      ],
      results: [],
    });
    expect(plan).toEqual([
      { kind: "grade_file", taskId: "t1", submissionId: "s1" },
      { kind: "no_file", taskId: "t2" },
      { kind: "ai_placeholder", taskId: "t3", submissionId: "s3" },
      { kind: "manual_pending", taskId: "t4", submissionId: null },
    ]);
  });

  it("module_package: every task uses the package ZIP", () => {
    const plan = planGrading({ uploadMode: "module_package", tasks, submissions: [{ id: "zip", task_id: null }], results: [] });
    expect(plan.map((p) => p.kind)).toEqual(["grade_package", "grade_package", "ai_placeholder", "manual_pending"]);
    expect(plan.every((p) => !("submissionId" in p) || p.submissionId === "zip")).toBe(true);
  });

  it("is idempotent: graded tasks are skipped, errors and pending are retried", () => {
    const plan = planGrading({
      uploadMode: "per_task",
      tasks,
      submissions: [
        { id: "s1", task_id: "t1" },
        { id: "s2", task_id: "t2" },
        { id: "s3", task_id: "t3" },
      ],
      results: [
        { task_id: "t1", status: "auto" },
        { task_id: "t2", status: "error" },
        { task_id: "t3", status: "ai_pending_review" },
        { task_id: "t4", status: "pending" },
      ],
    });
    expect(plan).toEqual([
      { kind: "skip", taskId: "t1" },
      { kind: "grade_file", taskId: "t2", submissionId: "s2" },
      { kind: "skip", taskId: "t3" },
      { kind: "skip", taskId: "t4" },
    ]);
  });
});

describe("readyForScoring", () => {
  it("waits for every auto task; manual may stay pending", () => {
    const done = [
      { task_id: "t1", status: "auto" },
      { task_id: "t2", status: "error" },
      { task_id: "t3", status: "ai_pending_review" },
      { task_id: "t4", status: "pending" },
    ];
    expect(readyForScoring(tasks, done)).toBe(true);
    expect(readyForScoring(tasks, done.slice(0, 3))).toBe(false);
    expect(readyForScoring(tasks, [{ task_id: "t1", status: "pending" }, ...done.slice(1)])).toBe(false);
    expect(readyForScoring([], [])).toBe(false);
  });
});

describe("mapLimit", () => {
  it("never runs more than the cap and keeps order", async () => {
    let running = 0;
    let peak = 0;
    const out = await mapLimit([1, 2, 3, 4, 5, 6, 7, 8, 9], 4, async (n) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5 + (n % 3)));
      running--;
      if (n === 5) throw new Error("boom");
      return n * 2;
    });
    expect(peak).toBe(4);
    expect(out.map((r) => (r.status === "fulfilled" ? r.value : "x"))).toEqual([2, 4, 6, 8, "x", 12, 14, 16, 18]);
  });
});

describe("package STEP files", () => {
  const info = (name: string, extra: Partial<ZipEntryInfo> = {}): ZipEntryInfo => ({
    name,
    compressedSize: 10,
    uncompressedSize: 10,
    isDirectory: false,
    ...extra,
  });

  it("selects safe STEP files, Parts and Assemblies first", () => {
    const picked = selectPackageSteps([
      info("A1/DAY 01/Results/Rendered Images/x.step"),
      info("A1/DAY 01/Results/Parts and Assemblies/Part_03.STEP"),
      info("A1/DAY 01/Results/Parts and Assemblies/Part_03.ipt"),
      info("../evil.step"),
      info("__MACOSX/A1/x.step"),
      info("A1/big.stp", { uncompressedSize: 60 * 1024 * 1024 }),
      info("A1/locked.stp", { encrypted: true }),
      info("A1/DAY 01/Results/Parts and Assemblies/", { isDirectory: true }),
    ]);
    expect(picked.map((p) => p.name)).toEqual(["A1/DAY 01/Results/Parts and Assemblies/Part_03.STEP", "A1/DAY 01/Results/Rendered Images/x.step"]);
  });

  function reader(bytes: Uint8Array): RangeReader {
    return async (start, end) => bytes.slice(start, end + 1);
  }

  it("extracts a stored entry", async () => {
    const zip = zipStore([
      { name: "Results/PDF files/a.pdf", data: "%PDF" },
      { name: "Results/Parts and Assemblies/Part_01.step", data: "ISO-10303-21;\nDATA;" },
    ]);
    const list = await readZipEntries(zip.length, reader(zip), { maxEntries: 500 });
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    const [step] = selectPackageSteps(list.entries);
    const data = await readZipEntryData(step.entry, reader(zip), 1024);
    expect(data.ok && new TextDecoder().decode(data.bytes)).toBe("ISO-10303-21;\nDATA;");
    expect(await readZipEntryData(step.entry, reader(zip), 5)).toEqual({ ok: false, reason: "too_large" });
  });

  it("inflates a deflated entry", async () => {
    const content = new TextEncoder().encode("ISO-10303-21;\n" + "#1=CARTESIAN_POINT('',(0.,0.,0.));\n".repeat(50));
    const packed = deflateRawSync(content);
    const name = new TextEncoder().encode("p.step");
    const local = new Uint8Array(30 + name.length + packed.length);
    const v = new DataView(local.buffer);
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(8, 8, true);
    v.setUint32(18, packed.length, true);
    v.setUint32(22, content.length, true);
    v.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(packed, 30 + name.length);
    const entry: ZipEntryInfo = { name: "p.step", compressedSize: packed.length, uncompressedSize: content.length, isDirectory: false, localHeaderOffset: 0, method: 8, encrypted: false };
    const data = await readZipEntryData(entry, reader(local), 1 << 20);
    expect(data.ok && data.bytes.length).toBe(content.length);
    expect(await readZipEntryData({ ...entry, method: 12 }, reader(local), 1 << 20)).toEqual({ ok: false, reason: "unsupported" });
  });
});

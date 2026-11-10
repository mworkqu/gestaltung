import { describe, expect, it } from "vitest";

import { cleanNote, collectStoragePaths, isUuid, removeChunks, sortDeletionRequests, type StorageEntry, type StorageLister } from "./deletion";

describe("sortDeletionRequests", () => {
  it("puts pending first (oldest first), then processed newest first", () => {
    const rows = [
      { id: "1", status: "approved" as const, createdAt: "2026-10-01T00:00:00Z", processedAt: "2026-10-03T00:00:00Z" },
      { id: "2", status: "pending" as const, createdAt: "2026-10-05T00:00:00Z", processedAt: null },
      { id: "3", status: "rejected" as const, createdAt: "2026-10-02T00:00:00Z", processedAt: "2026-10-04T00:00:00Z" },
      { id: "4", status: "pending" as const, createdAt: "2026-10-04T00:00:00Z", processedAt: null },
    ];
    expect(sortDeletionRequests(rows).map((r) => r.id)).toEqual(["4", "2", "3", "1"]);
  });
});

describe("validation helpers", () => {
  it("checks uuids and cleans notes", () => {
    expect(isUuid("00000000-0000-4000-8000-0000000000a1")).toBe(true);
    expect(isUuid("../etc")).toBe(false);
    expect(cleanNote("  ok  ")).toBe("ok");
    expect(cleanNote("   ")).toBeNull();
    expect(cleanNote(12)).toBeNull();
    expect(cleanNote("x".repeat(2000))?.length).toBe(1000);
  });
  it("splits removals into chunks", () => {
    expect(removeChunks(["a", "b", "c"], 2)).toEqual([["a", "b"], ["c"]]);
  });
});

function fakeLister(tree: Record<string, StorageEntry[]>, fail: string[] = []): StorageLister {
  return async (prefix, offset, limit) => {
    if (fail.includes(prefix)) return null;
    return (tree[prefix] ?? []).slice(offset, offset + limit);
  };
}

describe("collectStoragePaths", () => {
  const tree: Record<string, StorageEntry[]> = {
    u1: [
      { name: "attempt-a", id: null },
      { name: "root.png", id: "f0" },
    ],
    "u1/attempt-a": [
      { name: "task-1", id: null },
      { name: "pkg.zip", id: "f1" },
    ],
    "u1/attempt-a/task-1": [
      { name: "1_a.pdf", id: "f2" },
      { name: "2_b.pdf", id: "f3" },
      { name: "3_c.pdf", id: "f4" },
    ],
  };
  it("walks folders and pages every folder", async () => {
    const r = await collectStoragePaths(fakeLister(tree), "u1", { pageSize: 2 });
    expect(r.incomplete).toBe(false);
    expect(r.paths.sort()).toEqual(["u1/attempt-a/pkg.zip", "u1/attempt-a/task-1/1_a.pdf", "u1/attempt-a/task-1/2_b.pdf", "u1/attempt-a/task-1/3_c.pdf", "u1/root.png"]);
  });
  it("flags a failed listing, the file cap and the depth cap as incomplete", async () => {
    expect((await collectStoragePaths(fakeLister(tree, ["u1/attempt-a"]), "u1")).incomplete).toBe(true);
    const capped = await collectStoragePaths(fakeLister(tree), "u1", { maxFiles: 2 });
    expect(capped.incomplete).toBe(true);
    expect(capped.paths.length).toBe(2);
    expect((await collectStoragePaths(fakeLister(tree), "u1", { maxDepth: 1 })).incomplete).toBe(true);
  });
  it("ignores names that could leave the folder", async () => {
    const evil = fakeLister({ u1: [{ name: "../other", id: "x" }, { name: "a/b", id: "y" }, { name: "ok.txt", id: "z" }] });
    expect((await collectStoragePaths(evil, "u1")).paths).toEqual(["u1/ok.txt"]);
  });
});

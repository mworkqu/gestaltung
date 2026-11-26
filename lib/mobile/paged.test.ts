import { describe, expect, it } from "vitest";

import { PAGE_ROWS, paged } from "@/lib/mobile/paged";

/** A table of `total` rows behind a server that answers at most PAGE_ROWS. */
function table(total: number) {
  const calls: [number, number][] = [];
  const page = async (from: number, to: number) => {
    calls.push([from, to]);
    const end = Math.min(to + 1, from + PAGE_ROWS, total);
    const data = [];
    for (let i = from; i < end; i += 1) data.push({ id: i });
    return { data, error: null };
  };
  return { calls, page };
}

describe("paged", () => {
  it("reads past the 1,000 rows one request is answered with", async () => {
    const t = table(1339);
    const res = await paged<{ id: number }>(t.page, 5000);
    expect(res.error).toBe(false);
    expect(res.rows).toHaveLength(1339);
    expect(new Set(res.rows.map((r) => r.id)).size).toBe(1339);
    expect(t.calls).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it("asks once for a table that fits in one page", async () => {
    const t = table(12);
    const res = await paged(t.page, 5000);
    expect(res.rows).toHaveLength(12);
    expect(t.calls).toHaveLength(1);
  });

  it("asks again when the table ends exactly on a page", async () => {
    const t = table(2000);
    const res = await paged(t.page, 5000);
    expect(res.rows).toHaveLength(2000);
    expect(t.calls).toHaveLength(3);
  });

  it("stops at the cap and never asks for a row beyond it", async () => {
    const t = table(9000);
    const res = await paged(t.page, 2500);
    expect(res.rows).toHaveLength(2500);
    expect(t.calls[t.calls.length - 1]).toEqual([2000, 2499]);
  });

  it("fails the whole read when a later page fails", async () => {
    let n = 0;
    const res = await paged(async (from, to) => {
      n += 1;
      if (n === 2) return { data: null, error: { message: "timeout" } };
      return { data: Array.from({ length: to - from + 1 }, (_, i) => ({ id: from + i })), error: null };
    }, 5000);
    expect(res).toEqual({ rows: [], error: true });
  });
});

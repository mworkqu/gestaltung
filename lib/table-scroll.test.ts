// Mobile regression guard (P2-04): a <table> that is not inside a horizontal
// scroll container pushes the whole page sideways at 375 px. Every `<table`
// in app/** and components/** must have `overflow-x-auto` (or overflow-x-scroll
// / a `tbl` class) on the same line or within the 3 lines above it, i.e. on its
// direct wrapper, or carry an explicit `{/* no-scroll */}` opt-out there.
// Static text scan (fs + regex), no rendering.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const WINDOW = 3;
const SCROLL = /overflow-x-(auto|scroll)|\btbl\b|no-scroll/;

/** 1-based line numbers of `<table` tags with no scroll wrapper or opt-out nearby. */
function unwrappedTables(source: string): number[] {
  const lines = source.split(/\r?\n/);
  const hits: number[] = [];
  lines.forEach((line, i) => {
    if (!/<table[\s>]/.test(line)) return;
    const near = lines.slice(Math.max(0, i - WINDOW), i + 1).join("\n");
    if (!SCROLL.test(near)) hits.push(i + 1);
  });
  return hits;
}

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "node_modules" && !e.name.startsWith(".")) tsxFiles(p, out);
    } else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

describe("unwrappedTables", () => {
  it("accepts a table inside overflow-x-auto, within 3 lines", () => {
    const src = `<div className="neu overflow-x-auto p-2">\n  <table className="w-full">`;
    expect(unwrappedTables(src)).toEqual([]);
  });
  it("accepts the opt-out comment", () => {
    const src = `{/* no-scroll */}\n<table className="w-full">`;
    expect(unwrappedTables(src)).toEqual([]);
  });
  it("flags a bare table", () => {
    const src = `<section>\n  <h2>x</h2>\n  <table className="w-full">`;
    expect(unwrappedTables(src)).toEqual([3]);
  });
  it("flags a wrapper that is more than 3 lines away", () => {
    const src = `<div className="overflow-x-auto">\n<p>a</p>\n<p>b</p>\n<p>c</p>\n<table>`;
    expect(unwrappedTables(src)).toEqual([5]);
  });
});

describe("tables scroll sideways on phones", () => {
  it("every <table> in app/ and components/ has a scroll wrapper", () => {
    const bad: string[] = [];
    for (const dir of ["app", "components"]) {
      for (const file of tsxFiles(path.join(ROOT, dir))) {
        const lines = unwrappedTables(fs.readFileSync(file, "utf8"));
        if (lines.length) bad.push(`${path.relative(ROOT, file)}:${lines.join(",")}`);
      }
    }
    expect(bad, `Wrap in <div className="overflow-x-auto"> or add {/* no-scroll */}:\n${bad.join("\n")}`).toEqual([]);
  });
});

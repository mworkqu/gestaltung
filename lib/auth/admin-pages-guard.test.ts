import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// WEB-02 / G5.1: Next can render a page or route without its layouts, so every
// admin page under app/[locale]/dashboard must gate itself with
// requireSuperAdmin() (or, for a route handler, an explicit super_admin check).
// Source-level on purpose: the pages are not imported. A new admin page that
// forgets the guard fails here.

const ROOT = join(process.cwd(), "app", "[locale]", "dashboard");

function walk(dir: string, name: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, name, out);
    else if (entry === name) out.push(full);
  }
  return out;
}

const rel = (f: string) => relative(ROOT, f).split("\\").join("/");

// Pages that are deliberately NOT admin-only. Add to this list only with a
// reason that the code itself shows.
const NON_ADMIN_PAGES: Record<string, string> = {
  // Account view for every role: a client sees their own profile/tenant via the
  // RLS client; AdminHome is rendered only when role === "super_admin".
  "page.tsx": "dashboard home: all signed-in roles, admin tiles gated on role",
  // Only calls redirect() to the dashboard home; reads no data.
  "overview/page.tsx": "redirect only, reads nothing",
};

describe("dashboard admin pages are self-guarded (WEB-02)", () => {
  const pages = walk(ROOT, "page.tsx");

  it("finds the dashboard pages (guards against a broken walk)", () => {
    expect(pages.length).toBeGreaterThan(30);
  });

  it("every allow-listed page still exists", () => {
    const found = new Set(pages.map(rel));
    for (const p of Object.keys(NON_ADMIN_PAGES)) expect(found.has(p), p).toBe(true);
  });

  it("every page calls requireSuperAdmin( unless explicitly allow-listed", () => {
    const missing = pages
      .filter((f) => !(rel(f) in NON_ADMIN_PAGES))
      .filter((f) => !readFileSync(f, "utf8").includes("requireSuperAdmin("))
      .map(rel);
    expect(missing).toEqual([]);
  });

  it("the allow-listed pages do not read with the service-role client", () => {
    for (const p of Object.keys(NON_ADMIN_PAGES)) {
      expect(readFileSync(join(ROOT, p), "utf8"), p).not.toContain("createServiceClient");
    }
  });

  it("every route.ts checks requireSuperAdmin( or role === super_admin", () => {
    const routes = walk(ROOT, "route.ts");
    expect(routes.length).toBeGreaterThan(0);
    const unguarded = routes
      .filter((f) => {
        const src = readFileSync(f, "utf8");
        return !(src.includes("requireSuperAdmin(") || /["']super_admin["']/.test(src));
      })
      .map(rel);
    expect(unguarded).toEqual([]);
  });
});

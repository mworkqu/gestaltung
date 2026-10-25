import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Unit tests for pure logic (validators, matchers, import rules). Mirrors the
// "@/…" path alias from tsconfig.json.
export default defineConfig({
  resolve: {
    alias: [{ find: /^@\//, replacement: fileURLToPath(new URL("./", import.meta.url)) }],
  },
  // tsconfig keeps "jsx": "preserve" for Next; tests that import a page
  // (lib/auth/guards.test.ts) need the JSX compiled.
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    include: ["lib/**/*.test.ts"],
    environment: "node",
    // Several suites are deterministic but slow: they walk the whole source
    // tree (lib/i18n/scopes, lib/store/part-columns), compile a page, or apply
    // migrations in PGlite. Under a loaded full run they crossed vitest's 5 s
    // default and failed on time rather than on truth - three different files
    // did it while this branch was being built. A suite that flakes gets
    // ignored, so the limit is generous; a test that takes 20 s is a real
    // problem worth failing on.
    testTimeout: 20_000,
  },
});

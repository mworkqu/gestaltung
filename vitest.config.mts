import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Unit tests for pure logic (validators, matchers, import rules). Mirrors the
// "@/…" path alias from tsconfig.json.
export default defineConfig({
  resolve: {
    alias: [{ find: /^@\//, replacement: fileURLToPath(new URL("./", import.meta.url)) }],
  },
  test: {
    include: ["lib/**/*.test.ts"],
    environment: "node",
  },
});

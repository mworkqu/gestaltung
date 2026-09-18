import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ESLint 9 flat config. eslint-config-next still ships the legacy shareable
// format, so FlatCompat bridges it.
const compat = new FlatCompat({ baseDirectory: __dirname });

const config = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      // A gitignored reference Vite app kept for design reference only — it is
      // already excluded from tsconfig for the same reason.
      "Design that I like/**",
      "_archive/**",
      // Claude Code tooling, not project source.
      ".claude/**",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    // Tailwind reads its config through CommonJS, so the plugin import
    // has to stay a require().
    files: ["tailwind.config.ts"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
];

export default config;

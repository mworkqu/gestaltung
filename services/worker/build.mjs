// Bundles src/main.ts (and the repo's lib/** it imports through "@/…") into
// one file, dist/worker.mjs, with esbuild. The runtime image needs nothing
// else: no node_modules, no Next.
//
// The worker must never pull Next or React in: the plugin below fails the
// build when anything resolves to next/*, server-only or react. Split the pure
// part of such a lib module into its own file instead (docs/WORKER.md).

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");

function gitSha() {
  if (process.env.GIT_SHA) return process.env.GIT_SHA;
  try {
    return execFileSync("git", ["rev-parse", "--short=12", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

const FORBIDDEN = /^(next(\/.*)?|server-only|react(-dom)?(\/.*)?)$/;
const noNext = {
  name: "no-next",
  setup(b) {
    b.onResolve({ filter: /^(next|server-only|react)/ }, (args) => {
      if (FORBIDDEN.test(args.path)) {
        return { errors: [{ text: `worker bundle must not import "${args.path}" (from ${args.importer.replace(root, "")})` }] };
      }
      return undefined;
    });
  },
};

const result = await build({
  absWorkingDir: root,
  entryPoints: [resolve(here, "src/main.ts")],
  outfile: resolve(here, "dist/worker.mjs"),
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  tsconfig: resolve(here, "tsconfig.json"),
  sourcemap: "linked",
  metafile: true,
  legalComments: "none",
  logLevel: "warning",
  define: { __WORKER_BUILD_SHA__: JSON.stringify(gitSha()) },
  // CommonJS packages inside an ESM bundle still call require() for node built-ins.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  plugins: [noNext],
});

mkdirSync(resolve(here, "dist"), { recursive: true });
writeFileSync(resolve(here, "dist/meta.json"), JSON.stringify(result.metafile));
const bytes = Object.values(result.metafile.outputs).reduce((n, o) => n + o.bytes, 0);
process.stdout.write(`worker bundle: dist/worker.mjs (${Math.round(bytes / 1024)} KiB incl. map)\n`);

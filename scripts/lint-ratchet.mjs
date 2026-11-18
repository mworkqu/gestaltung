// Lint warning ratchet. `npm run lint` stays green on warnings (complexity,
// max-lines-per-function, no-console, consistent-type-imports) because today's
// hot spots exceed them; this script makes the count one-way instead: it fails
// when the number of ESLint warnings goes ABOVE the number stored in
// lint-ratchet.json, and tells you to lower the stored number when it drops.
// Errors always fail (eslint's own exit code), the ratchet only watches warnings.
//
//   npm run lint:ratchet            check
//   npm run lint:ratchet -- --update   write the current (lower) count
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const RATCHET_FILE = new URL("../lint-ratchet.json", import.meta.url);

/** Sum warnings and errors out of ESLint's JSON formatter output. */
export function countFromEslintJson(results) {
  let warnings = 0;
  let errors = 0;
  for (const file of results) {
    warnings += file.warningCount ?? 0;
    errors += file.errorCount ?? 0;
  }
  return { warnings, errors };
}

/**
 * Compare the measured warning count with the stored limit.
 * status: "fail" (above the limit), "improved" (below: lower the number), "ok" (equal).
 */
export function compareToRatchet(current, limit) {
  if (!Number.isInteger(limit) || limit < 0) throw new Error(`lint-ratchet.json: "warnings" must be a non-negative integer, got ${limit}`);
  if (current > limit) {
    return { status: "fail", message: `ESLint warnings went UP: ${current} > ${limit} allowed. Fix the new warnings; do not raise lint-ratchet.json.` };
  }
  if (current < limit) {
    return {
      status: "improved",
      message: `ESLint warnings dropped: ${current} < ${limit}. Lower "warnings" in lint-ratchet.json to ${current} (npm run lint:ratchet -- --update) so it cannot creep back.`,
    };
  }
  return { status: "ok", message: `ESLint warnings: ${current} (limit ${limit}).` };
}

function main() {
  const update = process.argv.includes("--update");
  const limit = JSON.parse(readFileSync(RATCHET_FILE, "utf8")).warnings;
  const run = spawnSync(process.execPath, [fileURLToPath(new URL("../node_modules/eslint/bin/eslint.js", import.meta.url)), ".", "-f", "json"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  let results;
  try {
    results = JSON.parse(run.stdout);
  } catch {
    console.error("lint-ratchet: eslint produced no JSON output.\n" + (run.stderr || ""));
    process.exit(2);
  }
  const { warnings, errors } = countFromEslintJson(results);
  if (errors > 0) {
    console.error(`lint-ratchet: ${errors} ESLint error(s); run npm run lint.`);
    process.exit(1);
  }
  const verdict = compareToRatchet(warnings, limit);
  if (update && verdict.status === "improved") {
    writeFileSync(RATCHET_FILE, JSON.stringify({ warnings }, null, 2) + "\n");
    console.log(`lint-ratchet: lowered the limit ${limit} -> ${warnings}.`);
    return;
  }
  (verdict.status === "fail" ? console.error : console.log)(`lint-ratchet: ${verdict.message}`);
  if (verdict.status === "fail") process.exit(1);
  // "improved" is a hint everywhere, never a failure: the count differs by a
  // warning or two between Windows and the Linux CI runner (first CI run:
  // 303 there, 304 here), so failing on "below" made CI red for no defect.
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();

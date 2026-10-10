// Static checks on model-written OpenSCAD, before the server accepts it. The
// browser render is the real test; this catches what would waste a render or
// reach outside the single file: empty or huge code, unbalanced brackets, no
// geometry at all, file access (import / include / use / surface) and $fn
// values that make a render crawl. Pure — no imports, so scripts can load it.

export const SCAD_MAX_BYTES = 20_000;
export const SCAD_MAX_FN = 64;

const PRIMITIVE = /\b(cube|sphere|cylinder|polyhedron|square|circle|polygon|text)\s*\(/;
const FORBIDDEN: [RegExp, string][] = [
  [/\bimport\s*\(/, "import() is not allowed — the file must be self-contained"],
  [/\binclude\s*</, "include <…> is not allowed — the file must be self-contained"],
  [/\buse\s*</, "use <…> is not allowed — the file must be self-contained"],
  [/\bsurface\s*\(/, "surface() is not allowed — it reads an external file"],
];

/** The code with comments and string contents blanked, so they cannot fool the checks. */
export function stripScad(code: string): string {
  let out = "";
  let i = 0;
  while (i < code.length) {
    const c = code[i];
    const n = code[i + 1];
    if (c === "/" && n === "/") {
      while (i < code.length && code[i] !== "\n") i++;
    } else if (c === "/" && n === "*") {
      const end = code.indexOf("*/", i + 2);
      i = end === -1 ? code.length : end + 2;
      out += " ";
    } else if (c === '"') {
      out += '""';
      i++;
      while (i < code.length && code[i] !== '"') i += code[i] === "\\" ? 2 : 1;
      i++;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** Models sometimes wrap code in a markdown fence even inside JSON. */
export function cleanScad(code: string): string {
  const fenced = code.trim().match(/^```[a-z]*\s*\n([\s\S]*?)\n?```$/i);
  return (fenced ? fenced[1] : code).trim() + "\n";
}

/** Problems with the code; empty means it may go to the browser. */
export function validateScad(code: string): string[] {
  const problems: string[] = [];
  if (!code.trim()) return ["the scad code is empty"];
  const bytes = new TextEncoder().encode(code).length;
  if (bytes >= SCAD_MAX_BYTES) problems.push(`the file is ${bytes} bytes; keep it under ${SCAD_MAX_BYTES}`);

  const bare = stripScad(code);

  const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
  const stack: string[] = [];
  let unbalanced: string | null = null;
  for (const ch of bare) {
    if (ch === "(" || ch === "[" || ch === "{") stack.push(ch);
    else if (ch in pairs) {
      if (stack.pop() !== pairs[ch]) {
        unbalanced = `unexpected "${ch}"`;
        break;
      }
    }
  }
  if (!unbalanced && stack.length) unbalanced = `${stack.length} unclosed "${stack[stack.length - 1]}"`;
  if (unbalanced) problems.push(`brackets are unbalanced: ${unbalanced}`);

  if (!PRIMITIVE.test(bare)) problems.push("the file makes no geometry (no cube, cylinder, sphere, polygon … call)");
  for (const [re, msg] of FORBIDDEN) if (re.test(bare)) problems.push(msg);

  const fns = [...bare.matchAll(/\$fn\s*=\s*(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
  if (fns.some((v) => v > SCAD_MAX_FN)) problems.push(`$fn must be at most ${SCAD_MAX_FN}`);

  return problems;
}

// ─── CadQuery (cloud engine) ────────────────────────────────────────────────
// A cheap pre-check before the code goes to the worker (which runs it in its
// own sandbox): size, the `result` variable, imports limited to cadquery and
// math, and no file / process / dynamic-code access.

export const CADQUERY_MAX_BYTES = 20_000;

const PY_ALLOWED_MODULES = new Set(["cadquery", "math"]);
const PY_FORBIDDEN: [RegExp, string][] = [
  [/\b(open|exec|eval|compile|__import__|globals|locals|getattr|setattr|input)\s*\(/, "file access and dynamic code (open, exec, eval, __import__ …) are not allowed"],
  [/\b(os|sys|subprocess|socket|shutil|pathlib|importlib)\s*\./, "only cadquery and math may be used"],
  [/__\w+__/, "dunder names are not allowed"],
  [/\b(exportStep|exportStl|export|show_object)\s*\(|cq\.exporters\b/, "do not export or show: leave the final shape in `result`"],
];

/** The Python with comments and string contents blanked. */
function stripPython(code: string): string {
  return code
    .replace(/("""|''')[\s\S]*?\1/g, '""')
    .replace(/"(?:\.|[^"\\n])*"|'(?:\.|[^'\\n])*'/g, '""')
    .replace(/#.*$/gm, "");
}

/** Problems with model-written CadQuery; empty means it may go to the worker. */
export function validateCadQuery(code: string): string[] {
  const problems: string[] = [];
  if (!code.trim()) return ["the code is empty"];
  const bytes = new TextEncoder().encode(code).length;
  if (bytes >= CADQUERY_MAX_BYTES) problems.push(`the file is ${bytes} bytes; keep it under ${CADQUERY_MAX_BYTES}`);
  const bare = stripPython(code);

  for (const m of bare.matchAll(/^\s*(?:import\s+([\w.]+)(?:\s+as\s+\w+)?|from\s+([\w.]+)\s+import\b)/gm)) {
    const mod = (m[1] ?? m[2] ?? "").split(".")[0];
    if (!PY_ALLOWED_MODULES.has(mod)) problems.push(`import of "${mod}" is not allowed — only cadquery and math`);
  }
  if (!/^\s*(import\s+cadquery\b|from\s+cadquery\b)/m.test(bare)) problems.push('the file must start with "import cadquery as cq"');
  if (!/^result\s*=/m.test(bare)) problems.push("the final shape must be assigned to a top-level variable named `result`");
  for (const [re, msg] of PY_FORBIDDEN) if (re.test(bare)) problems.push(msg);
  return [...new Set(problems)];
}

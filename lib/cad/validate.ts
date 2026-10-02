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

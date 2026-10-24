import { describe, expect, it } from "vitest";

import { SCAD_MAX_BYTES, cleanScad, stripScad, validateCadQuery, validateScad } from "./validate";

const BOX = `// A box
width = 40; // mm
module shell() { difference() { cube([width, 30, 20]); translate([2, 2, 2]) cube([width - 4, 26, 20]); } }
shell();
`;

describe("validateScad", () => {
  it("accepts a plain parametric part", () => {
    expect(validateScad(BOX)).toEqual([]);
  });

  it("rejects empty code", () => {
    expect(validateScad("  \n ")).toEqual(["the scad code is empty"]);
  });

  it("rejects a file at or over the size limit", () => {
    const big = `cube(1);\n${"// padding\n".repeat(Math.ceil(SCAD_MAX_BYTES / 11))}`;
    expect(validateScad(big).some((p) => p.includes("bytes"))).toBe(true);
  });

  it("finds unbalanced and mismatched brackets", () => {
    expect(validateScad("cube([1, 2, 3);")[0]).toMatch(/unbalanced/);
    expect(validateScad("module a() { cube(1);")[0]).toMatch(/unclosed "\{"/);
    expect(validateScad("cube(1));")[0]).toMatch(/unexpected "\)"/);
  });

  it("ignores brackets and keywords inside comments and strings", () => {
    expect(validateScad(`// import("x.stl") {\n/* use <MCAD> ( */\necho("a { [ (");\ncube(2);`)).toEqual([]);
  });

  it("requires some geometry", () => {
    expect(validateScad("x = 3; echo(x);")).toEqual([expect.stringMatching(/no geometry/)]);
  });

  it("refuses file access", () => {
    expect(validateScad('import("part.stl");').some((p) => p.includes("import()"))).toBe(true);
    expect(validateScad("include <MCAD/boxes.scad>\ncube(1);").some((p) => p.includes("include"))).toBe(true);
    expect(validateScad("use <lib.scad>\ncube(1);").some((p) => p.includes("use <"))).toBe(true);
    expect(validateScad('surface(file = "h.dat");').some((p) => p.includes("surface()"))).toBe(true);
  });

  it("does not mistake names that merely contain the keywords", () => {
    expect(validateScad("reuse = 2; important = 1; cube(reuse + important);")).toEqual([]);
  });

  it("caps $fn at 64", () => {
    expect(validateScad("cylinder(h = 5, r = 3, $fn = 64);")).toEqual([]);
    expect(validateScad("$fn = 128;\ncylinder(h = 5, r = 3);")).toEqual(["$fn must be at most 64"]);
  });
});

describe("cleanScad / stripScad", () => {
  it("unwraps a markdown fence", () => {
    expect(cleanScad("```openscad\ncube(1);\n```")).toBe("cube(1);\n");
    expect(cleanScad("cube(1);")).toBe("cube(1);\n");
  });

  it("blanks comments and string contents", () => {
    expect(stripScad('a = "x(y"; // c\ncube(1); /* d */')).toBe('a = ""; \ncube(1);  ');
  });
});

describe("validateCadQuery", () => {
  const GOOD = [
    "import cadquery as cq",
    "import math",
    "W = 60.0",
    'body = cq.Workplane("XY").box(W, 40, 20).faces(">Z").shell(-2)',
    "result = body",
  ].join("\n");

  it("an ordinary model passes", () => {
    expect(validateCadQuery(GOOD)).toEqual([]);
  });

  it("rejects file-reading attribute chains (AI-03, mirrors the worker)", () => {
    for (const attr of ["parse_file", "parseFile", "read_text", "read", "write_bytes", "load", "fromfile"]) {
      const problems = validateCadQuery(`import cadquery as cq\nx = cq.selectors.Literal("x").${attr}("/etc/passwd")\nresult = 1\n`);
      expect(problems.some((p) => p.includes("file access"))).toBe(true);
    }
  });

  it("rejects a match class pattern with a dunder keyword", () => {
    const code = "import cadquery as cq\nmatch 1:\n    case int(__class__=k):\n        pass\nresult = 1\n";
    expect(validateCadQuery(code)).toContain("dunder names are not allowed");
  });

  it("blanks string literals containing the letter n (no false positive on banned words inside quotes)", () => {
    // Before the fix the string class excluded the letter "n", so these were left unblanked.
    const code = `${GOOD}\nlabel = "no open(x) or os.path in an engine note"\nother = 'an exec(y) mention'\n`;
    expect(validateCadQuery(code)).toEqual([]);
  });

  it("an apostrophe inside a double-quoted string cannot hide real code (no false negative)", () => {
    const code = `${GOOD}\nnote = "don't"; y = os.getcwd(); z = 'x'\n`;
    expect(validateCadQuery(code)).toContain("only cadquery and math may be used");
  });

  it("still catches a banned attribute outside strings", () => {
    const code = `${GOOD}\nnote = "an harmless string"\ndata = cq.importers.thing.read("x")\n`;
    expect(validateCadQuery(code).some((p) => p.includes("file access"))).toBe(true);
  });

  it("does not flag names that only start like a banned one", () => {
    expect(validateCadQuery(`${GOOD}\nreadable = body.loaded_value if False else 1\n`)).toEqual([]);
  });
});

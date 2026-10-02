// What Gemini is told when it writes a CAD model. Server-only in the app;
// pure (no imports) so the pipeline proof script can send exactly this.

export const CAD_SYSTEM = `You are a mechanical design engineer. You write OpenSCAD code for parts that will be 3D printed (FDM) and return JSON only: {"scad", "summary", "dimensions"}.

Rules for scad:
- ONE complete, self-contained .scad file. Units are millimetres.
- Start with the parametric variables (overall sizes, wall thickness, clearances, hole diameters, gaps), each with a short // comment. Then modules. Then the top-level calls.
- Core OpenSCAD only: cube, sphere, cylinder, polyhedron, square, circle, polygon, linear_extrude, rotate_extrude, union, difference, intersection, hull, translate, rotate, scale, mirror, offset, for, if, let, module, function. NEVER import(), include <...>, use <...>, surface() or any library (no MCAD, no BOSL). Avoid text(); if a label is essential, use text() with the default font only (no font= argument).
- $fn at most 64 anywhere (48 suits most round features, 24 to 32 for small holes). Avoid minkowski().
- Printable: every piece is one closed, manifold solid; walls at least 1.6 mm thick; no zero-thickness walls or coincident faces — cutting bodies overshoot the faces they cut by at least 0.5 mm; nothing floating.
- Origin on the print bed: every piece rests on z = 0 and nothing goes below z = 0.
- Several pieces (for example a box and its lid): lay them side by side on the bed with a 10 mm gap, each in its best print orientation (a lid upside down), never assembled in place.
- Use the real published dimensions of any named off-the-shelf part (boards, connectors, motors, batteries, screws), plus clearance: 0.5 mm per side for a part that must fit inside, 0.2 mm for a press fit. Mounting holes for M3 screws are 3.2 mm, M2.5 are 2.7 mm.
- Keep it fast to render: a few hundred primitives at most.

summary: one to three short sentences: what you modelled and its key sizes, in the language asked for.
dimensions: the overall size in mm of everything the file produces, as laid out on the bed: {"x", "y", "z"}.`;

export const CAD_SCHEMA = {
  type: "object",
  properties: {
    scad: { type: "string" },
    summary: { type: "string" },
    dimensions: {
      type: "object",
      properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } },
      required: ["x", "y", "z"],
    },
  },
  required: ["scad", "summary"],
} as const;

/** The user prompt: a new model, a change to an earlier one, or a repair of code that failed to build. */
export function cadPrompt(opts: {
  request: string;
  locale: "en" | "ar";
  previous?: { scad: string; request: string } | null;
  buildError?: string | null;
}): string {
  const lang = `Write the summary in ${opts.locale === "ar" ? "Arabic" : "English"}. Code, variable names and comments stay in English.`;
  if (!opts.previous) return `${lang}\n\nPart to model:\n"""\n${opts.request.slice(0, 2000)}\n"""`;
  const current = `The part was asked for as:\n"""\n${opts.previous.request.slice(0, 2000)}\n"""\n\nCurrent OpenSCAD file:\n\`\`\`\n${opts.previous.scad}\n\`\`\``;
  if (opts.buildError)
    return `${lang}\n\n${current}\n\nOpenSCAD failed to build this file into a solid. Its output:\n"""\n${opts.buildError.slice(0, 3000)}\n"""\n\nFix the cause and return the FULL corrected file (not a diff). Keep the design and the parameters the same unless the fix needs a change.`;
  return `${lang}\n\n${current}\n\nChange request:\n"""\n${opts.request.slice(0, 2000)}\n"""\n\nReturn the FULL revised file (not a diff). Keep the parameters at the top and change only what the request needs.`;
}

// Writes a small, valid ASCII STL of an L-shaped bracket (80 x 60 x 40 mm,
// 4 mm thick) for the file-to-part recording. Faces are subdivided so the file
// has a realistic size.  node scripts/record-videos/make-sample-stl.mjs <out.stl>
import fs from "node:fs";

const out = process.argv[2];
if (!out) { console.error("Usage: node make-sample-stl.mjs <out.stl>"); process.exit(1); }
const N = 14; // subdivisions per face edge
const lines = ["solid bracket"];
const tri = (n, a, b, c) => {
  lines.push(`  facet normal ${n.join(" ")}`, "    outer loop");
  for (const v of [a, b, c]) lines.push(`      vertex ${v.map((x) => x.toFixed(3)).join(" ")}`);
  lines.push("    endloop", "  endfacet");
};
// One axis-aligned box as 6 subdivided faces.
function box([x0, y0, z0], [x1, y1, z1]) {
  const faces = [
    { n: [0, 0, -1], p: (u, v) => [x0 + (x1 - x0) * u, y0 + (y1 - y0) * v, z0], flip: true },
    { n: [0, 0, 1], p: (u, v) => [x0 + (x1 - x0) * u, y0 + (y1 - y0) * v, z1] },
    { n: [0, -1, 0], p: (u, v) => [x0 + (x1 - x0) * u, y0, z0 + (z1 - z0) * v] },
    { n: [0, 1, 0], p: (u, v) => [x0 + (x1 - x0) * u, y1, z0 + (z1 - z0) * v], flip: true },
    { n: [-1, 0, 0], p: (u, v) => [x0, y0 + (y1 - y0) * u, z0 + (z1 - z0) * v], flip: true },
    { n: [1, 0, 0], p: (u, v) => [x1, y0 + (y1 - y0) * u, z0 + (z1 - z0) * v] },
  ];
  for (const f of faces) {
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const a = f.p(i / N, j / N), b = f.p((i + 1) / N, j / N), c = f.p((i + 1) / N, (j + 1) / N), d = f.p(i / N, (j + 1) / N);
      if (f.flip) { tri(f.n, a, c, b); tri(f.n, a, d, c); } else { tri(f.n, a, b, c); tri(f.n, a, c, d); }
    }
  }
}
box([0, 0, 0], [80, 40, 4]);   // base plate
box([0, 0, 4], [4, 40, 60]);   // upright
lines.push("endsolid bracket");
fs.writeFileSync(out, lines.join("\n") + "\n");
console.log(`${out}: ${(fs.statSync(out).size / 1048576).toFixed(2)} MB`);

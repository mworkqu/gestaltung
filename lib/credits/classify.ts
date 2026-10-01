// classifyCadRequest — a keyword heuristic until the CAD stage brings the real
// classifier. Tier is shown in the cost dialog and stored on the project; every
// tier costs one CAD session for now. Engine: OpenSCAD for plain prismatic
// parts, CadQuery once fillets, threads, lofts or assemblies are involved.

export type CadTier = "simple" | "standard" | "complex";
export type CadEngine = "openscad" | "cadquery";

const COMPLEX = [
  "assembly", "hinge", "gear", "thread", "threaded", "spring", "snap fit", "snap-fit", "living hinge", "loft",
  "sweep", "organic", "curved", "ergonomic", "multi-part", "multiple parts", "mechanism", "linkage", "impeller",
  "propeller", "turbine", "تجميع", "مفصل", "ترس", "تروس", "لولب", "سن", "زنبرك", "منحني", "آلية",
];
const STANDARD = [
  "enclosure", "case", "housing", "box with lid", "lid", "mount", "bracket", "holder", "clip", "fillet",
  "chamfer", "rounded", "slot", "vent", "standoff", "screw hole", "screw holes", "cutout", "boss", "rib",
  "علبة", "غطاء", "حامل", "قاعدة", "مشبك", "فتحة", "فتحات", "تثبيت",
];

export function classifyCadRequest(description: string): { tier: CadTier; engine: CadEngine } {
  const text = ` ${description.toLowerCase().replace(/\s+/g, " ")} `;
  const has = (words: string[]) => words.filter((w) => text.includes(w)).length;
  const complex = has(COMPLEX);
  const standard = has(STANDARD);
  const words = text.trim() ? text.trim().split(" ").length : 0;

  if (complex >= 1 || standard >= 4 || words > 120) return { tier: "complex", engine: "cadquery" };
  if (standard >= 1 || words > 40) return { tier: "standard", engine: standard >= 2 ? "cadquery" : "openscad" };
  return { tier: "simple", engine: "openscad" };
}

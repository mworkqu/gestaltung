// Gemini response-schema pieces for BOM lines with typed attributes, built
// from the one attribute definition (lib/store/attributes) so the model is
// asked for exactly the keys our matcher compares. Server-only.

import { CLASSES, type AttrClass } from "@/lib/store/attributes";

const enumOf = (values: readonly string[]) => ({ type: "STRING", format: "enum", enum: [...values] });

/** An OBJECT whose properties are every field of the given classes (all optional). */
export function attributesSchema(classes: AttrClass[]) {
  const properties: Record<string, object> = {};
  for (const c of classes)
    for (const f of CLASSES[c].fields) {
      if (properties[f.key]) continue;
      properties[f.key] =
        f.type === "number"
          ? { type: "NUMBER" }
          : f.type === "list"
            ? { type: "ARRAY", items: { type: "STRING" } }
            : "options" in f && f.options
              ? enumOf(f.options)
              : { type: "STRING" };
    }
  return { type: "OBJECT", properties };
}

/** One line of the prompt per class, listing its keys and units, for the model. */
export function attributesGuide(classes: AttrClass[]): string {
  return classes
    .map(
      (c) =>
        `  ${c}: ${CLASSES[c].fields
          .map((f) => `${f.key}${"unit" in f && f.unit ? ` (${f.unit})` : ""}${"options" in f && f.options ? ` one of ${f.options.join("|")}` : ""}`)
          .join("; ")}`
    )
    .join("\n");
}

export const bomLineSchema = (
  classes: AttrClass[],
  groups: readonly string[],
  kinds: readonly string[],
  /** Extra keys the model must always send (the electronics list needs class + group). */
  alsoRequired: readonly string[] = []
) => ({
  type: "OBJECT",
  properties: {
    id: { type: "STRING" },
    function: { type: "STRING" },
    spec: { type: "STRING" },
    quantity: { type: "INTEGER" },
    kind: enumOf(kinds),
    critical: { type: "BOOLEAN" },
    class: enumOf(classes),
    group: enumOf(groups),
    attributes: attributesSchema(classes),
  },
  required: ["id", "function", "spec", "quantity", "kind", "critical", ...alsoRequired],
});

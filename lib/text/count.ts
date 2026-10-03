// Arabic count agreement for customer-facing counts ("107 منتجًا").
//
// CLDR's Arabic plural categories do NOT match how the store wants to read:
// 103–110 are `few` in CLDR (so "107 منتجات"), but the owner's rule is
//   1 → منتج واحد · 2 → منتجان · 3–10 → N منتجات · 11 and up → N منتجًا.
// So the form is chosen here and passed into the message through ICU
// `select` (…{form, select, one {…} two {…} few {…} many {…}}), instead of
// relying on `plural`.

export type ArabicCountForm = "zero" | "one" | "two" | "few" | "many";

export function arabicCountForm(n: number): ArabicCountForm {
  const v = Math.abs(Math.trunc(n));
  if (v === 0) return "zero";
  if (v === 1) return "one";
  if (v === 2) return "two";
  if (v <= 10) return "few";
  return "many";
}

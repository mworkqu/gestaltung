import type { Part } from "@/lib/supabase/types";

// QAR price string, locale-aware: "QAR 12.50" (en) / "12.50 ر.ق" (ar).
export function formatPrice(value: number, locale: string): string {
  const amount = value.toFixed(2);
  return locale === "ar" ? `${amount} ر.ق` : `QAR ${amount}`;
}

// The part name to show for the active locale, falling back to the base name.
export function partName(
  part: Pick<Part, "name" | "name_ar">,
  locale: string
): string {
  if (locale === "ar" && part.name_ar && part.name_ar.trim() !== "") {
    return part.name_ar;
  }
  return part.name;
}

// The locale-aware description, falling back to the base description.
export function partDescription(
  part: Pick<Part, "description" | "description_ar">,
  locale: string
): string | null {
  if (locale === "ar" && part.description_ar && part.description_ar.trim() !== "") {
    return part.description_ar;
  }
  return part.description ?? null;
}

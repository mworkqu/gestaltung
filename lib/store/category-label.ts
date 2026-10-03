// Store categories are stored in English (the filter value). This gives the
// Arabic label to show; an unknown category shows as stored.
//
// Since C5 (0048) the storefront shows the nine store categories
// (lib/store/store-categories.ts). The older source categories (parts.category)
// keep their labels for admin pages, for rows read before 0048 runs, and so the
// Arabic words customers learned still find the right products.

import type { StoreCategory } from "@/lib/store/store-categories";

/** The nine storefront categories (owner-approved wording, 2026-10-04). */
const STORE_AR: Record<StoreCategory, string> = {
  "Boards and microcontrollers": "لوحات ومتحكمات دقيقة",
  Sensors: "مستشعرات",
  Modules: "وحدات",
  "Chips and ICs": "رقائق ودوائر متكاملة",
  Power: "الطاقة",
  "Motors and mechanical": "محركات وقطع ميكانيكية",
  "Cables and connectors": "كابلات وموصلات",
  "Tools and accessories": "أدوات وملحقات",
  "3D printing": "الطباعة ثلاثية الأبعاد",
};

/** Source categories (parts.category) that are not also store categories. */
const SOURCE_AR: Record<string, string> = {
  "3D printers": "طابعات ثلاثية الأبعاد",
  "3D printing filament": "خيوط الطباعة ثلاثية الأبعاد",
  "3D printer parts": "قطع الطابعات ثلاثية الأبعاد",
  "Raspberry Pi": "راسبيري باي",
  Microcontrollers: "المتحكمات الدقيقة",
  Kits: "المجموعات",
  "Chips & ICs": "الرقائق والدوائر المتكاملة",
  Displays: "الشاشات",
  Motors: "المحركات",
  Prototyping: "النماذج الأولية",
  Components: "المكونات الإلكترونية",
  Fasteners: "المثبتات",
  Mechanical: "القطع الميكانيكية",
  Tools: "الأدوات",
  Other: "أخرى",
};

const AR: Record<string, string> = { ...SOURCE_AR, ...STORE_AR };

// Older / colloquial Arabic words customers still type for a category, plus
// the labels the store showed before C5 for categories whose wording changed.
// These only feed search; the displayed label is the one above.
const AR_SEARCH_ALIASES: Record<string, string[]> = {
  Sensors: ["حساسات", "الحساسات", "حساس", "الحساس", "حسّاسات", "حسّاس", "المستشعرات"],
  Kits: ["أطقم", "الأطقم", "اطقم", "الاطقم", "طقم", "الطقم"],
  Modules: ["الوحدات", "موديول", "موديولات"],
  "Boards and microcontrollers": ["المتحكمات الدقيقة", "متحكم", "المتحكم", "لوحات تطوير", "لوحة تطوير", "أردوينو", "اردوينو"],
  "Chips and ICs": ["الرقائق والدوائر المتكاملة", "رقاقة", "شرائح", "دوائر متكاملة"],
  "Motors and mechanical": ["المحركات", "محرك", "المحرك", "القطع الميكانيكية", "ميكانيكية"],
  "Cables and connectors": ["كابل", "الكابلات", "أسلاك", "اسلاك", "سلك", "موصل", "الموصلات"],
  "Tools and accessories": ["الأدوات", "أداة", "عدة", "ملحقات"],
  "3D printing": ["طابعة", "الطابعة", "طابعات", "الطابعات", "طباعة", "خيوط", "فلامنت", "ريزن", "راتنج"],
};

/**
 * Categories (store or source) whose Arabic label or alias contains this
 * Arabic text: "مستشعرات" / "حساسات" → Sensors, "متحكمات" → Boards and
 * microcontrollers + Microcontrollers, "طابعة" → 3D printing. Search matches
 * the result against both parts.store_category and parts.category.
 */
export function categoriesForArabicTerm(term: string): string[] {
  const t = term.trim();
  if (t.length < 3 || !/[؀-ۿ]/.test(t)) return [];
  return Object.entries(AR)
    .filter(
      ([category, label]) =>
        label.includes(t) || (AR_SEARCH_ALIASES[category] ?? []).some((a) => a.includes(t)),
    )
    .map(([category]) => category);
}

export function categoryLabel(category: string | null | undefined, locale: string): string {
  if (!category) return "";
  return locale === "ar" ? AR[category] ?? category : category;
}

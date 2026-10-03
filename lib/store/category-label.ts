// Store categories are stored in English (the filter value). This gives the
// Arabic label to show; an unknown category shows as stored.

const AR: Record<string, string> = {
  "3D printers": "طابعات ثلاثية الأبعاد",
  "3D printing filament": "خيوط الطباعة ثلاثية الأبعاد",
  "3D printer parts": "قطع الطابعات ثلاثية الأبعاد",
  "Raspberry Pi": "راسبيري باي",
  Microcontrollers: "المتحكمات الدقيقة",
  Kits: "المجموعات",
  "Chips & ICs": "الرقائق والدوائر المتكاملة",
  Displays: "الشاشات",
  Modules: "الوحدات",
  Sensors: "المستشعرات",
  Motors: "المحركات",
  Power: "الطاقة",
  Prototyping: "النماذج الأولية",
  Components: "المكونات الإلكترونية",
  Fasteners: "المثبتات",
  Mechanical: "القطع الميكانيكية",
  Tools: "الأدوات",
  Other: "أخرى",
};

// Older / colloquial Arabic words customers still type for a category. The
// displayed label is the canonical one above (مستشعرات, مجموعات); these only
// keep search working for the previous wording.
const AR_SEARCH_ALIASES: Record<string, string[]> = {
  Sensors: ["حساسات", "الحساسات", "حساس", "الحساس", "حسّاسات", "حسّاس"],
  Kits: ["أطقم", "الأطقم", "اطقم", "الاطقم", "طقم", "الطقم"],
};

/** Stored categories whose Arabic label contains this Arabic text (search "مستشعرات" or "حساسات" → Sensors). */
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

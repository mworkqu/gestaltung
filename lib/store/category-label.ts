// Store categories are stored in English (the filter value). This gives the
// Arabic label to show; an unknown category shows as stored.

const AR: Record<string, string> = {
  "3D printers": "طابعات ثلاثية الأبعاد",
  "3D printing filament": "خيوط الطباعة ثلاثية الأبعاد",
  "3D printer parts": "قطع الطابعات ثلاثية الأبعاد",
  "Raspberry Pi": "راسبيري باي",
  Microcontrollers: "المتحكمات الدقيقة",
  Kits: "الأطقم",
  "Chips & ICs": "الرقائق والدوائر المتكاملة",
  Displays: "الشاشات",
  Modules: "الوحدات",
  Sensors: "الحساسات",
  Motors: "المحركات",
  Power: "الطاقة",
  Prototyping: "النماذج الأولية",
  Components: "المكونات الإلكترونية",
  Fasteners: "المثبتات",
  Mechanical: "القطع الميكانيكية",
  Tools: "الأدوات",
  Other: "أخرى",
};

export function categoryLabel(category: string | null | undefined, locale: string): string {
  if (!category) return "";
  return locale === "ar" ? AR[category] ?? category : category;
}

// Plain names of the printed parts (EN / AR). Its own file so pages that only
// list parts (W2 "Request received") don't import three.js via ./build.

import type { MechTemplate } from "../schema";

export const MECH_NAMES: Record<MechTemplate, { en: string; ar: string }> = {
  standoff: { en: "Standoff", ar: "عمود تثبيت" },
  pcb_cradle: { en: "Board cradle", ar: "حامل اللوحة" },
  battery_clip: { en: "Battery clip", ar: "مشبك البطارية" },
  sensor_mount: { en: "Sensor mount", ar: "حامل المستشعر" },
  cable_clip: { en: "Cable clip", ar: "مشبك السلك" },
  button_extender: { en: "Button extender", ar: "ممدّد الزر" },
  light_pipe: { en: "Light pipe", ar: "موجّه الضوء" },
  wall_bracket: { en: "Wall bracket", ar: "حامل الحائط" },
  lid: { en: "Lid", ar: "الغطاء" },
  base: { en: "Base", ar: "القاعدة" },
};

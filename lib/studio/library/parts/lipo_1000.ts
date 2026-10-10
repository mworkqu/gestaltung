import type { LibraryPart } from "../../schema";

// 3.7 V 1000 mAh LiPo pouch (603450: 6 x 34 x 50 mm) with a short lead and JST-PH plug at -x.
// Polarity of the JST plug varies between sellers: check it before connecting.
export const lipo1000: LibraryPart = {
  id: "lipo_1000",
  name: { en: "Flat rechargeable battery (LiPo 1000 mAh)", ar: "بطارية مسطحة قابلة للشحن (LiPo 1000 مللي أمبير)" },
  blurb: {
    en: "A thin rechargeable battery that powers small products for hours.",
    ar: "بطارية رفيعة قابلة للشحن تشغّل المنتجات الصغيرة لساعات.",
  },
  category: "power",
  storeSkus: [],
  tags: ["battery", "lipo", "lithium", "li-po", "rechargeable", "pouch", "flat", "thin", "cordless", "portable", "wearable", "power", "3.7v", "1000mah", "jst"],
  dims: { x: 62, y: 34, z: 6.5 },
  model: { kind: "procedural", builder: "lipoPouch", params: {} },
  look: { body: "battery_wrap" },
  mount: null,
  ports: [],
  pins: [
    { id: "BAT_PLUS", label: "Battery + (red wire)", role: "out", voltage: 3.7, side: "right" },
    { id: "BAT_MINUS", label: "Battery - (black wire)", role: "gnd", voltage: 0, side: "left" },
  ],
  power: { vMin: 3, vMax: 4.2, logicV: 3.3, mA: 0 },
  clearance: 1.5,
};

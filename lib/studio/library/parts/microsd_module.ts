import type { LibraryPart } from "../../schema";

// Micro SD card module (SPI): reads and writes a memory card, for logging data or playing sounds.
// 5 V supply (regulator and level buffers onboard), 3.3 V-safe signals. The card slot is at the -x
// end; there is no card-slot port kind, so it is a sensor_window with a slot-sized opening.
export const microsdModule: LibraryPart = {
  id: "microsd_module",
  name: { en: "Memory card module (micro SD)", ar: "وحدة بطاقة ذاكرة (micro SD)" },
  blurb: {
    en: "Saves readings and files to a memory card you can pull out and read on a computer.",
    ar: "تحفظ القراءات والملفات على بطاقة ذاكرة يمكنك إخراجها وقراءتها على الحاسوب.",
  },
  category: "connector",
  storeSkus: [],
  tags: ["sd", "microsd", "micro-sd", "card", "memory", "storage", "logger", "datalogger", "log", "spi", "record", "save", "audio", "files", "flash"],
  dims: { x: 42, y: 24, z: 9 },
  model: {
    kind: "procedural",
    builder: "moduleBoard",
    params: {
      boardT: 1.6,
      r: 1,
      feats: [
        { t: "box", x: -13.5, y: 0, w: 15, d: 14.5, h: 1.9, m: "metal" },
        { t: "box", x: -21, y: 0, w: 0.1, d: 11.5, h: 1, z: 2.1, c: "#050506" },
        { t: "box", x: 1, y: 6, w: 8.7, d: 3.9, h: 1.5, c: "#15161a" },
        { t: "box", x: 2, y: -5.5, w: 6.5, d: 3.5, h: 1.6, c: "#15161a" },
        { t: "box", x: 8, y: 0, w: 1.6, d: 0.8, h: 0.5, c: "#2a2523" },
        { t: "box", x: -3, y: -8, w: 1.6, d: 0.8, h: 0.5, c: "#2a2523" },
        { t: "led", x: 10, y: 8, c: "#35d07f" },
      ],
      rows: [{ x: 18, y: 0, n: 6, axis: "y", kind: "pins" }],
    },
  },
  look: { body: "pcb_blue" },
  mount: null,
  ports: [{ kind: "sensor_window", face: "-x", at: { u: 0.5, v: 0.283 }, size: { w: 12, h: 2.2 } }],
  pins: [
    { id: "GND", label: "GND", role: "gnd", voltage: 0, side: "right" },
    { id: "VCC", label: "VCC (5 V)", role: "5v", voltage: 5, side: "right" },
    { id: "MISO", label: "MISO", role: "spi_miso", voltage: 3.3, side: "right" },
    { id: "MOSI", label: "MOSI", role: "spi_mosi", voltage: 3.3, side: "right" },
    { id: "SCK", label: "SCK", role: "spi_sck", voltage: 3.3, side: "right" },
    { id: "CS", label: "CS", role: "spi_cs", voltage: 3.3, side: "right" },
  ],
  power: { vMin: 4.5, vMax: 5.5, logicV: 3.3, mA: 80 },
  clearance: 2,
};

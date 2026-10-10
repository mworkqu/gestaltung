import type { LibraryPart, Pin, PinRole } from "../../schema";

// ESP32 DevKit V1 (30-pin): 51.5 x 28.5 mm, USB micro at -x, pin headers up.
// Header order follows the silkscreen. "left" = -y row, "right" = +y row.
const L: [string, string, PinRole, number?][] = [
  ["EN", "EN (reset)", "in", 3.3],
  ["GPIO36", "VP / GPIO36", "adc", 3.3],
  ["GPIO39", "VN / GPIO39", "adc", 3.3],
  ["GPIO34", "GPIO34", "adc", 3.3],
  ["GPIO35", "GPIO35", "adc", 3.3],
  ["GPIO32", "GPIO32", "adc", 3.3],
  ["GPIO33", "GPIO33", "adc", 3.3],
  ["GPIO25", "GPIO25", "gpio", 3.3],
  ["GPIO26", "GPIO26", "gpio", 3.3],
  ["GPIO27", "GPIO27", "gpio", 3.3],
  ["GPIO14", "GPIO14", "gpio", 3.3],
  ["GPIO12", "GPIO12", "gpio", 3.3],
  ["GPIO13", "GPIO13", "gpio", 3.3],
  ["GND_L", "GND", "gnd", 0],
  ["VIN", "VIN (5 V)", "vin", 5],
];
const R: [string, string, PinRole, number?][] = [
  ["GPIO23", "GPIO23 (MOSI)", "spi_mosi", 3.3],
  ["GPIO22", "GPIO22 (SCL)", "i2c_scl", 3.3],
  ["GPIO1", "TX0 / GPIO1", "uart_tx", 3.3],
  ["GPIO3", "RX0 / GPIO3", "uart_rx", 3.3],
  ["GPIO21", "GPIO21 (SDA)", "i2c_sda", 3.3],
  ["GPIO19", "GPIO19 (MISO)", "spi_miso", 3.3],
  ["GPIO18", "GPIO18 (SCK)", "spi_sck", 3.3],
  ["GPIO5", "GPIO5 (CS)", "spi_cs", 3.3],
  ["GPIO17", "TX2 / GPIO17", "uart_tx", 3.3],
  ["GPIO16", "RX2 / GPIO16", "uart_rx", 3.3],
  ["GPIO4", "GPIO4", "gpio", 3.3],
  ["GPIO2", "GPIO2", "gpio", 3.3],
  ["GPIO15", "GPIO15", "gpio", 3.3],
  ["GND_R", "GND", "gnd", 0],
  ["3V3", "3V3", "3v3", 3.3],
];

const toPins = (rows: typeof L, side: Pin["side"]): Pin[] =>
  rows.map(([id, label, role, voltage]) => ({ id, label, role, voltage, side }));

export const esp32Devkit: LibraryPart = {
  id: "esp32_devkit",
  name: { en: "ESP32 brain board (Wi-Fi + Bluetooth)", ar: "لوحة التحكم ESP32 (واي فاي وبلوتوث)" },
  blurb: {
    en: "A small computer that runs your program and connects to Wi-Fi and Bluetooth.",
    ar: "حاسوب صغير ينفّذ برنامجك ويتصل بالواي فاي والبلوتوث.",
  },
  category: "mcu",
  storeSkus: [],
  tags: ["esp32", "wifi", "bluetooth", "ble", "microcontroller", "brain", "controller", "iot", "smart", "wireless", "devkit", "3.3v"],
  dims: { x: 51.5, y: 28.5, z: 10 },
  model: {
    kind: "procedural",
    builder: "devBoard",
    params: {
      chip: "esp32",
      usb: "micro",
      boardT: 1.6,
      rows: [
        { y: 12.7, x0: 0, n: 15, kind: "pins" },
        { y: -12.7, x0: 0, n: 15, kind: "pins" },
      ],
    },
  },
  look: { body: "pcb_black" },
  mount: null,
  ports: [
    { kind: "usb_micro", face: "-x", at: { u: 0.5, v: 0.3 }, size: { w: 8, h: 3.2 } },
  ],
  pins: [...toPins(L, "left"), ...toPins(R, "right")],
  power: { vMin: 3.3, vMax: 5.5, logicV: 3.3, mA: 160 },
  clearance: 2,
};

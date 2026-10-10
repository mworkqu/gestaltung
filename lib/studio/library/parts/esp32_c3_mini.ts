import type { LibraryPart, Pin, PinRole } from "../../schema";

// ESP32-C3 "Super Mini": 22.5 x 18 mm, USB-C at -x, 2 x 8 pin rows (castellated + header).
// Row order follows the silkscreen; "left" = -y row, "right" = +y row. I2C/SPI use the
// Arduino-ESP32 C3 defaults (SDA 8, SCL 9; SCK 4, MISO 5, MOSI 6, SS 7).
const L: [string, string, PinRole, number?][] = [
  ["VIN", "5V (USB in)", "vin", 5],
  ["GND_L", "GND", "gnd", 0],
  ["3V3", "3V3", "3v3", 3.3],
  ["GPIO4", "GPIO4 (SCK)", "spi_sck", 3.3],
  ["GPIO3", "GPIO3", "gpio", 3.3],
  ["GPIO2", "GPIO2", "adc", 3.3],
  ["GPIO1", "GPIO1", "adc", 3.3],
  ["GPIO0", "GPIO0", "adc", 3.3],
];
const R: [string, string, PinRole, number?][] = [
  ["GPIO5", "GPIO5 (MISO)", "spi_miso", 3.3],
  ["GPIO6", "GPIO6 (MOSI)", "spi_mosi", 3.3],
  ["GPIO7", "GPIO7 (CS)", "spi_cs", 3.3],
  ["GPIO8", "GPIO8 (SDA)", "i2c_sda", 3.3],
  ["GPIO9", "GPIO9 (SCL)", "i2c_scl", 3.3],
  ["GPIO10", "GPIO10", "gpio", 3.3],
  ["GPIO20", "RX / GPIO20", "uart_rx", 3.3],
  ["GPIO21", "TX / GPIO21", "uart_tx", 3.3],
];
const toPins = (rows: typeof L, side: Pin["side"]): Pin[] =>
  rows.map(([id, label, role, voltage]) => ({ id, label, role, voltage, side }));

export const esp32C3Mini: LibraryPart = {
  id: "esp32_c3_mini",
  name: { en: "Tiny ESP32-C3 brain board (Wi-Fi + Bluetooth)", ar: "لوحة تحكم صغيرة ESP32-C3 (واي فاي وبلوتوث)" },
  blurb: {
    en: "A thumb-sized board that runs your program and connects to Wi-Fi and Bluetooth.",
    ar: "لوحة بحجم الإبهام تنفّذ برنامجك وتتصل بالواي فاي والبلوتوث.",
  },
  category: "mcu",
  storeSkus: [],
  tags: ["esp32", "esp32c3", "c3", "supermini", "wifi", "bluetooth", "ble", "microcontroller", "brain", "controller", "iot", "smart", "wireless", "tiny", "small", "wearable", "compact", "usb-c", "3.3v"],
  dims: { x: 22.5, y: 18, z: 8.5 },
  model: {
    kind: "procedural",
    builder: "moduleBoard",
    params: {
      boardT: 1.2,
      r: 1,
      feats: [
        { t: "usbc", side: -1, y: 0 },
        { t: "box", x: 3, y: 0, w: 5, d: 5, h: 0.9, c: "#15161a" },
        { t: "box", x: 8.6, y: 0, w: 4.4, d: 10, h: 0.06, m: "gold" },
        { t: "box", x: -2.4, y: -4.6, w: 3, d: 3.6, h: 1.4, c: "#d8d8d8", rough: 0.4, metalness: 0.5 },
        { t: "box", x: -2.4, y: 4.6, w: 3, d: 3.6, h: 1.4, c: "#d8d8d8", rough: 0.4, metalness: 0.5 },
        { t: "led", x: 4, y: 5, c: "#2d7bff" },
      ],
      rows: [
        { x: 0, y: -7.62, n: 8, kind: "pins" },
        { x: 0, y: 7.62, n: 8, kind: "pins" },
      ],
    },
  },
  look: { body: "pcb_black" },
  mount: null,
  ports: [{ kind: "usb_c", face: "-x", at: { u: 0.5, v: 0.33 }, size: { w: 9.2, h: 3.4 } }],
  pins: [...toPins(L, "left"), ...toPins(R, "right")],
  power: { vMin: 3.3, vMax: 6, logicV: 3.3, mA: 120 },
  clearance: 2,
};

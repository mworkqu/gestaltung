import type { LibraryPart, Pin, PinRole } from "../../schema";

// Raspberry Pi Pico W (RP2040 + Wi-Fi/Bluetooth): 51 x 21 mm, micro-USB at -x,
// 2 x 20 pin rows. "left" = pins 1-20 (-y row), "right" = pins 21-40 (+y row).
// Bus roles use the default Pico buses (I2C0 on GP4/GP5, SPI0 on GP16-19, UART0 on GP0/GP1).
type Row = [string, string, PinRole, number?];
const gp = (n: number, role: PinRole = "gpio", label = `GP${n}`): Row => [`GP${n}`, label, role, 3.3];
const gnd = (n: number): Row => [`GND_${n}`, "GND", "gnd", 0];
const L: Row[] = [
  gp(0, "uart_tx", "GP0 (TX)"),
  gp(1, "uart_rx", "GP1 (RX)"),
  gnd(1),
  gp(2), gp(3),
  gp(4, "i2c_sda", "GP4 (SDA)"),
  gp(5, "i2c_scl", "GP5 (SCL)"),
  gnd(2),
  gp(6), gp(7), gp(8), gp(9),
  gnd(3),
  gp(10), gp(11), gp(12), gp(13),
  gnd(4),
  gp(14), gp(15),
];
const R: Row[] = [
  gp(16, "spi_miso", "GP16 (MISO)"),
  gp(17, "spi_cs", "GP17 (CS)"),
  gnd(5),
  gp(18, "spi_sck", "GP18 (SCK)"),
  gp(19, "spi_mosi", "GP19 (MOSI)"),
  gp(20), gp(21),
  gnd(6),
  gp(22),
  gnd(7),
  gp(26, "adc", "GP26 (ADC0)"),
  gp(27, "adc", "GP27 (ADC1)"),
  gnd(8),
  gp(28, "adc", "GP28 (ADC2)"),
  ["3V3", "3V3 (out)", "3v3", 3.3],
  ["VSYS", "VSYS (power in)", "vin", 5],
  ["VBUS", "VBUS (USB 5 V)", "5v", 5],
];
const toPins = (rows: Row[], side: Pin["side"]): Pin[] =>
  rows.map(([id, label, role, voltage]) => ({ id, label, role, voltage, side }));

export const picoW: LibraryPart = {
  id: "pico_w",
  name: { en: "Raspberry Pi Pico W brain board (Wi-Fi)", ar: "لوحة التحكم Raspberry Pi Pico W (واي فاي)" },
  blurb: {
    en: "A small, sturdy board that runs your program and can join your Wi-Fi.",
    ar: "لوحة صغيرة متينة تنفّذ برنامجك ويمكنها الاتصال بالواي فاي.",
  },
  category: "mcu",
  storeSkus: [],
  tags: ["pico", "picow", "rp2040", "raspberry", "wifi", "microcontroller", "brain", "controller", "micropython", "python", "iot", "wireless", "devkit", "3.3v", "dual-core"],
  dims: { x: 51, y: 21, z: 9 },
  model: {
    kind: "procedural",
    builder: "moduleBoard",
    params: {
      boardT: 1,
      r: 1.2,
      feats: [
        { t: "micro", side: -1, y: 0 },
        { t: "box", x: -15, y: 0, w: 4, d: 4, h: 1.6, c: "#e8e8e8", rough: 0.5 },
        { t: "box", x: -9, y: -4.5, w: 6, d: 5, h: 0.9, c: "#15161a" },
        { t: "box", x: -3, y: 1.5, w: 7, d: 7, h: 0.9, c: "#15161a" },
        { t: "box", x: 12.5, y: 0, w: 11, d: 9, h: 1.5, m: "metal" },
        { t: "box", x: 21, y: 0, w: 7, d: 5.5, h: 0.06, m: "gold" },
        { t: "led", x: -12, y: 6, c: "#35d07f" },
      ],
      rows: [
        { x: 0, y: -8.89, n: 20, kind: "pins" },
        { x: 0, y: 8.89, n: 20, kind: "pins" },
      ],
    },
  },
  look: { body: "pcb_green" },
  mount: null,
  ports: [{ kind: "usb_micro", face: "-x", at: { u: 0.5, v: 0.26 }, size: { w: 7.5, h: 3.2 } }],
  pins: [...toPins(L, "left"), ...toPins(R, "right")],
  power: { vMin: 1.8, vMax: 5.5, logicV: 3.3, mA: 100 },
  clearance: 2,
};

import type { LibraryPart, Pin } from "../../schema";

// PCA9685 16-channel, 12-bit I2C PWM / servo driver board (62.5 x 25.4 mm). Default I2C address 0x40
// (the A0-A5 solder jumpers change it). Logic VCC 3.3-5 V; servo power comes SEPARATELY on the V+ screw
// terminal (5-6 V), so the servo current never flows through the board's logic pin. The I2C pins accept
// 3.3 V or 5 V logic.
//
// Pins: GND / OE (output enable, active low, optional) / SCL / SDA / VCC (logic), then the screw terminal
// V_PLUS / V_GND (servo power in), then the 16 three-pin servo outputs, per channel n = 0..15:
//   CH<n>_PWM (signal), CH<n>_V (V+, fed from the terminal), CH<n>_GND.
// A servo on channel n connects SIG -> CH<n>_PWM, VCC -> CH<n>_V, GND -> CH<n>_GND.
const CH = 16;
const channelPins: Pin[] = [];
for (let n = 0; n < CH; n++) {
  channelPins.push(
    { id: `CH${n}_PWM`, label: `CH${n} PWM (servo signal)`, role: "pwm", voltage: 5, side: "top" },
    { id: `CH${n}_V`, label: `CH${n} V+`, role: "5v", voltage: 5, side: "top" },
    { id: `CH${n}_GND`, label: `CH${n} GND`, role: "gnd", voltage: 0, side: "top" },
  );
}

// 3D pin positions (channel headers + I2C header + V+ terminal) are in wiring3d/pins3d.ts OVERRIDES.

export const pca9685Servo: LibraryPart = {
  id: "pca9685_servo",
  name: { en: "Servo driver board (16 channels, PCA9685)", ar: "لوحة تشغيل السيرفو (16 قناة، PCA9685)" },
  blurb: {
    en: "Runs up to 16 servos from just two wires of your board, with its own power input for the servos.",
    ar: "تشغّل حتى 16 سيرفو بسلكين فقط من لوحتك، مع مدخل طاقة خاص بالسيرفو.",
  },
  category: "actuator",
  storeSkus: ["VLT-44494294942013"],
  tags: ["driver", "module", "servo_driver", "servo", "pca9685", "pwm", "i2c", "16_channel", "multi_servo", "robot", "arm", "actuator", "expander", "movement", "0x40"],
  dims: { x: 62.5, y: 25.4, z: 10 },
  model: {
    kind: "procedural",
    builder: "moduleBoard",
    params: {
      boardT: 1.6,
      r: 1,
      feats: [
        { t: "box", x: 4, y: -2, w: 6.4, d: 4.4, h: 1.2, c: "#15161a" },
        { t: "box", x: -6, y: -4, w: 1.6, d: 0.8, h: 0.5, c: "#2a2523" },
        { t: "box", x: -9, y: -4, w: 1.6, d: 0.8, h: 0.5, c: "#2a2523" },
        { t: "cyl", x: 14, y: -3, r: 3.2, h: 8, c: "#2b2f3a" },
        { t: "led", x: 8, y: -6, c: "#35d07f" },
        { t: "screw", x: 24.5, y: 0, n: 2, axis: "y", pitch: 5.08, h: 8.1 },
      ],
      rows: [
        { x: -4, y: 10.16, n: 16, axis: "x", kind: "pins", tip: 9 },
        { x: -4, y: 7.62, n: 16, axis: "x", kind: "pins", tip: 9 },
        { x: -4, y: 5.08, n: 16, axis: "x", kind: "pins", tip: 9 },
        { x: -4, y: -10.16, n: 6, axis: "x", kind: "pins", tip: 9 },
      ],
    },
  },
  look: { body: "pcb_blue" },
  mount: null,
  ports: [],
  pins: [
    { id: "GND", label: "GND", role: "gnd", voltage: 0, side: "bottom" },
    { id: "OE", label: "OE (output enable, optional)", role: "gpio", voltage: 3.3, side: "bottom" },
    { id: "SCL", label: "SCL", role: "i2c_scl", voltage: 3.3, side: "bottom" },
    { id: "SDA", label: "SDA", role: "i2c_sda", voltage: 3.3, side: "bottom" },
    { id: "VCC", label: "VCC (logic, 3.3-5 V)", role: "3v3", voltage: 3.3, side: "bottom" },
    { id: "V_PLUS", label: "V+ (servo power in, 5-6 V)", role: "5v", voltage: 5, side: "right" },
    { id: "V_GND", label: "V+ terminal GND", role: "gnd", voltage: 0, side: "right" },
    ...channelPins,
  ],
  // mA = logic draw only; servo current flows from the V+ terminal and is counted per servo.
  power: { vMin: 3.0, vMax: 6, logicV: 3.3, mA: 10 },
  clearance: 2,
};

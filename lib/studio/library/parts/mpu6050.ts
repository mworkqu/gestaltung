import type { LibraryPart } from "../../schema";

// MPU-6050 (GY-521) 6-axis motion sensor (accelerometer + gyroscope), I2C. Onboard regulator:
// 3.3-5 V supply, 3.3 V signals. 8-pin header at the -y edge; two mounting holes at the +y side.
export const mpu6050: LibraryPart = {
  id: "mpu6050",
  name: { en: "Motion and tilt sensor (MPU-6050)", ar: "حسّاس الحركة والميلان (MPU-6050)" },
  blurb: {
    en: "Feels shaking, tilting and turning, so your product knows how it is being moved.",
    ar: "يشعر بالاهتزاز والميلان والدوران ليعرف منتجك كيف يتم تحريكه.",
  },
  category: "sensor",
  storeSkus: [],
  tags: ["motion", "tilt", "accelerometer", "gyroscope", "gyro", "imu", "mpu6050", "gy-521", "orientation", "shake", "balance", "robot", "drone", "wearable", "step", "gesture", "i2c", "sensor", "vibration"],
  dims: { x: 21.2, y: 16.4, z: 10 },
  model: {
    kind: "procedural",
    builder: "moduleBoard",
    params: {
      boardT: 1.6,
      r: 0.8,
      feats: [
        { t: "box", x: 1, y: 1.5, w: 4, d: 4, h: 0.9, c: "#15161a" },
        { t: "box", x: -6, y: 1.5, w: 3, d: 2.6, h: 1, c: "#15161a" },
        { t: "box", x: 6.5, y: -2, w: 1.6, d: 0.8, h: 0.5, c: "#2a2523" },
        { t: "box", x: -2, y: -2, w: 1.6, d: 0.8, h: 0.5, c: "#2a2523" },
        { t: "led", x: 6, y: 5.5, c: "#ff3b30" },
      ],
      rows: [{ x: 0, y: -6.7, n: 8, kind: "pins" }],
    },
  },
  look: { body: "pcb_blue" },
  mount: {
    holes: [
      { x: -8.5, y: 5.6, d: 3 },
      { x: 8.5, y: 5.6, d: 3 },
    ],
    standoffHeight: 3,
  },
  ports: [],
  pins: [
    { id: "VCC", label: "VCC (3.3-5 V)", role: "vin", side: "bottom" },
    { id: "GND", label: "GND", role: "gnd", voltage: 0, side: "bottom" },
    { id: "SCL", label: "SCL", role: "i2c_scl", voltage: 3.3, side: "bottom" },
    { id: "SDA", label: "SDA", role: "i2c_sda", voltage: 3.3, side: "bottom" },
  ],
  power: { vMin: 3.3, vMax: 5, logicV: 3.3, mA: 4 },
  clearance: 1.5,
};

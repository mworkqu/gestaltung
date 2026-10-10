// Small fake LibraryParts for layout / enclosure tests (independent of the real library).

import { DEFAULT_ENCLOSURE, ENCLOSURE_TEMPLATES, LibraryPartSchema, type EnclosureSpec, type EnclosureTemplate, type LibraryPart, type Port } from "../schema";

/** Every enclosure template (all eight are built since Phase 3). */
export const ALL_TEMPLATES: readonly EnclosureTemplate[] = ENCLOSURE_TEMPLATES;

type FakeOpts = {
  category?: LibraryPart["category"];
  dims: [number, number, number];
  ports?: Port[];
  tags?: string[];
  clearance?: number;
  helper?: boolean;
};

export function fakePart(id: string, o: FakeOpts): LibraryPart {
  return LibraryPartSchema.parse({
    id,
    name: { en: id, ar: id },
    blurb: { en: "Test part.", ar: "Test part." },
    category: o.category ?? "sensor",
    storeSkus: [],
    tags: o.tags ?? [],
    dims: { x: o.dims[0], y: o.dims[1], z: o.dims[2] },
    model: { kind: "procedural", builder: "box", params: {} },
    look: { body: "pcb_green" },
    mount: null,
    ports: o.ports ?? [],
    pins: [],
    power: { vMin: 3.3, vMax: 5, logicV: 3.3, mA: 10 },
    clearance: o.clearance ?? 1,
    ...(o.helper ? { helper: true } : {}),
  });
}

export const port = (kind: Port["kind"], face: Port["face"], w: number, h: number, u = 0.5, v = 0.5): Port => ({
  kind,
  face,
  at: { u, v },
  size: { w, h },
});

export const P = {
  board: fakePart("mcu_board", { category: "mcu", dims: [52, 28, 8], ports: [port("usb_c", "-x", 9, 3.2, 0.5, 0.6)], clearance: 1.5 }),
  lipo: fakePart("lipo_cell", { category: "power", dims: [40, 22, 6], tags: ["battery"] }),
  bigCell: fakePart("cell_18650", { category: "power", dims: [70, 20, 20], tags: ["battery"] }),
  display: fakePart("oled_display", { category: "display", dims: [36, 26, 4], ports: [port("display_window", "+z", 26, 14)] }),
  sensor: fakePart("env_sensor", { dims: [20, 15, 3], ports: [port("sensor_window", "+y", 6, 3)] }),
  jack: fakePart("dc_jack_part", { category: "connector", dims: [14, 9, 11], ports: [port("dc_jack", "+x", 9, 9)] }),
  button: fakePart("push_button", { category: "input", dims: [12, 12, 7], ports: [port("button_cap", "+z", 8, 8)] }),
  led: fakePart("status_led", { category: "output", dims: [5, 5, 6], ports: [port("led_light_pipe", "+z", 3, 3)], helper: true }),
  resistor: fakePart("resistor_220", { category: "output", dims: [6, 2, 2], helper: true }),
  speaker: fakePart("speaker_20mm", { category: "output", dims: [22, 22, 5], ports: [port("speaker_grille", "+z", 14, 14)], clearance: 2 }),
  frontUsb: fakePart("front_usb", { category: "connector", dims: [16, 12, 5], ports: [port("usb_micro", "-y", 8, 3)] }),
  tall: fakePart("tall_tower", { dims: [10, 10, 90] }),
  tiny: fakePart("tiny_chip", { dims: [3, 3, 1] }),
};

export const items = (...parts: [string, LibraryPart][]) => parts.map(([instanceId, part]) => ({ instanceId, part }));

export const typical = () =>
  items(
    ["u1", P.board],
    ["b1", P.lipo],
    ["d1", P.display],
    ["s1", P.sensor],
    ["j1", P.jack],
    ["k1", P.button],
    ["l1", P.led],
    ["r1", P.resistor],
    ["sp1", P.speaker],
    ["f1", P.frontUsb],
  );

type SpecOverrides = Partial<Omit<EnclosureSpec, "proportions">> & { proportions?: Partial<EnclosureSpec["proportions"]> };

export const spec = (o: SpecOverrides = {}): EnclosureSpec => ({
  ...DEFAULT_ENCLOSURE,
  ...o,
  proportions: { ...DEFAULT_ENCLOSURE.proportions, ...(o.proportions ?? {}) },
});

// Golden fixtures for P5-16: the five acceptance ideas as they leave the Idea and
// Parts steps (spec JSON + picked parts, the AI mocked), so the archetype default
// → solver → kernel chain can be tested without any network call.

import { CODE_LIBRARY } from "../../library";
import { clampSpec, type ProductSpec } from "../../schema";
import type { LayoutInput } from "../../layout";

export type GoldenIdea = {
  key: "plant_waterer" | "desk_lamp" | "cat_feeder" | "doorbell" | "tv_remote";
  /** What the client typed. */
  idea: string;
  spec: ProductSpec;
  /** Library part ids (an id twice = two instances). */
  partIds: string[];
};

/** The owner's test idea, word for word (2026-10-11). */
export const PLANT_WATERER_IDEA =
  "Plant Waterer — automatically waters your plant when the soil gets dry. Stands in the soil next to the plant, waters with a small pump, lights up to show what it's doing, runs from USB, about the size of your palm.";

export const GOLDEN_IDEAS: GoldenIdea[] = [
  {
    key: "plant_waterer",
    idea: PLANT_WATERER_IDEA,
    spec: clampSpec({
      name: "Plant Waterer",
      oneLine: "Waters your plant automatically when the soil gets dry.",
      use: "desk",
      power: "usb",
      environment: "indoor",
      features: ["automatic watering", "soil moisture sensing", "status light", "small pump"],
      inputs: [],
      outputs: ["led", "pump"],
      sizeHint: "palm",
      style: "rounded",
      placement: "plant_soil",
      quantity: 1,
    }),
    partIds: ["esp32_c3_mini", "soil_moisture_cap", "pump_5v", "motor_driver", "ws2812_ring"],
  },
  {
    key: "desk_lamp",
    idea: "Desk lamp with touch dimming",
    spec: clampSpec({
      name: "Desk lamp",
      oneLine: "A desk lamp you dim with a touch.",
      use: "desk",
      power: "usb",
      environment: "indoor",
      features: ["touch dimming", "warm light"],
      inputs: ["touch"],
      outputs: ["led"],
      sizeHint: "desk",
      style: "minimal",
      quantity: 1,
    }),
    partIds: ["esp32_c3_mini", "ws2812_ring"],
  },
  {
    key: "cat_feeder",
    idea: "Automatic cat feeder",
    spec: clampSpec({
      name: "Automatic cat feeder",
      oneLine: "Feeds your cat on a schedule.",
      use: "desk",
      power: "mains_adapter",
      environment: "indoor",
      features: ["scheduled feeding", "portion control"],
      inputs: ["button"],
      outputs: ["motor"],
      sizeHint: "large",
      style: "rounded",
      quantity: 1,
    }),
    partIds: ["esp32_devkit", "sg90_servo", "usbc_power_5v", "button_6mm"],
  },
  {
    key: "doorbell",
    idea: "Smart doorbell",
    spec: clampSpec({
      name: "Smart doorbell",
      oneLine: "A doorbell that rings and lights up.",
      use: "wall",
      power: "battery_usb",
      environment: "indoor",
      features: ["chime", "light ring"],
      inputs: ["button"],
      outputs: ["speaker", "led"],
      sizeHint: "palm",
      style: "soft_tech",
      quantity: 1,
    }),
    partIds: ["esp32_c3_mini", "button_6mm", "speaker_amp", "led_5mm", "lipo_1000", "tp4056_usbc"],
  },
  {
    key: "tv_remote",
    idea: "Handheld TV remote",
    spec: clampSpec({
      name: "TV remote",
      oneLine: "A handheld remote for the TV.",
      use: "handheld",
      power: "battery",
      environment: "indoor",
      features: ["infrared", "buttons"],
      inputs: ["button"],
      outputs: ["led"],
      sizeHint: "palm",
      style: "minimal",
      quantity: 1,
    }),
    partIds: ["esp32_c3_mini", "button_6mm", "button_6mm", "button_6mm", "led_5mm", "aa_holder_2"],
  },
];

/** The picked parts as layout inputs (instance ids `<id>_<n>`, numbered in order). */
export function goldenParts(idea: GoldenIdea): LayoutInput[] {
  return idea.partIds.map((id, i) => {
    const part = CODE_LIBRARY.getPart(id);
    if (!part) throw new Error(`fixture part ${id} is not in the library`);
    return { instanceId: `${id}_${i + 1}`, part };
  });
}

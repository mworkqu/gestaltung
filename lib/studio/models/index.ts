// Registry of procedural builders + buildPartModel().

import * as THREE from "three";
import type { LibraryPart } from "../schema";
import type { ModelBuilder } from "./types";
import { mat } from "./materials";
import { rbox, finish } from "./shapes";
import { devBoard } from "./devBoard";
import { battery18650 } from "./battery18650";
import { chargerBoard } from "./chargerBoard";
import { pirSensor } from "./pirSensor";
import { dht22 } from "./dht22";
import { oledDisplay } from "./oledDisplay";
import { pushButton } from "./pushButton";
import { led } from "./led";
import { resistor } from "./resistor";
import { moduleBoard } from "./moduleBoard";
import { aaHolder } from "./aaHolder";
import { lipoPouch } from "./lipoPouch";
import { ultrasonicSensor } from "./ultrasonicSensor";
import { ledRing } from "./ledRing";
import { buzzer } from "./buzzer";
import { speakerAmp } from "./speakerAmp";
import { servo } from "./servo";
import { n20Motor } from "./n20Motor";
import { slideSwitch } from "./slideSwitch";
import { ds18b20Probe } from "./ds18b20Probe";
import { lcdModule } from "./lcdModule";

export const BUILDERS: Record<string, ModelBuilder> = {
  devBoard,
  battery18650,
  chargerBoard,
  pirSensor,
  dht22,
  oledDisplay,
  pushButton,
  led,
  resistor,
  moduleBoard,
  aaHolder,
  lipoPouch,
  ultrasonicSensor,
  ledRing,
  buzzer,
  speakerAmp,
  servo,
  n20Motor,
  slideSwitch,
  ds18b20Probe,
  lcdModule,
};

/** Grey rounded box of the part's dims (STL parts: the viewer swaps in the real mesh). */
export function placeholderModel(part: LibraryPart): THREE.Group {
  const g = new THREE.Group();
  const { x, y, z } = part.dims;
  g.add(rbox("placeholder", x, y, z, Math.min(x, y, z) * 0.15, 0, 0, 0, mat("#9aa3ad", { roughness: 0.6 }), 2));
  return finish(g, part.id);
}

/**
 * Builds the 3D group for a part. Procedural parts use their registered
 * builder (an unknown builder falls back to the placeholder so the viewer never
 * crashes; validatePart() reports it). STL parts return the placeholder.
 */
export function buildPartModel(part: LibraryPart): THREE.Group {
  if (part.model.kind === "procedural") {
    const builder = BUILDERS[part.model.builder];
    if (builder) return builder({ part, params: part.model.params });
  }
  return placeholderModel(part);
}

export type { ModelBuilder, BuildContext } from "./types";
export { mat } from "./materials";

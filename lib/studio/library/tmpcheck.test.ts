import { it } from "vitest";
import { writeFileSync } from "node:fs";
import * as THREE from "three";
import { LIBRARY, validatePart } from "./index";
import { buildPartModel } from "../models";

it("diag", () => {
  const out: string[] = [];
  for (const p of LIBRARY) {
    const g = buildPartModel(p);
    let tris = 0;
    g.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        const geo = o.geometry as THREE.BufferGeometry;
        tris += geo.index ? geo.index.count / 3 : geo.getAttribute("position").count / 3;
      }
    });
    const b = new THREE.Box3().setFromObject(g).getSize(new THREE.Vector3());
    out.push([p.id.padEnd(20), "tris", Math.round(tris), "size", b.x.toFixed(1), b.y.toFixed(1), b.z.toFixed(1), "want", p.dims.x, p.dims.y, p.dims.z, validatePart(p).join(" | ")].join(" "));
  }
  writeFileSync("C:/Users/mmamr/AppData/Local/Temp/diag.txt", out.join("\n"));
});

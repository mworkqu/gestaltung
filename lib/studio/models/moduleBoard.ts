// Generic small PCB module (sensor / power / driver / MCU boards): a board slab
// plus data-driven features, so most library parts need no builder of their own.
//
// params:
//   boardT: PCB thickness (mm, default 1.6)        boardZ: z of the PCB underside (default 0)
//   boardW / boardD / boardX / boardY: PCB footprint when smaller than dims (default = dims, centred)
//   r: PCB corner radius (default 1)
//   feats: [{ t, x, y, ... }] sitting on the PCB top (override with z = absolute bottom)
//     box   { w, d, h, c?, m? }        any block; c = colour hex, m = "metal" | "gold" | "black"
//     cyl   { r, h, c?, m?, seg? }     upright cylinder
//     led   { c }                      tiny glowing SMD LED
//     usbc | micro | mini { side }     USB receptacle flush with the -1 / +1 x edge of the PCB
//     screw { n, axis, pitch?, h? }    blue screw-terminal block (axis "x" | "y")
//     pot   { }                        blue trimmer with a brass screw
//     pads  { n, axis, pitch? }        gold solder pads
//     jst   { w?, d?, h? }             white 2 mm JST-style connector
//   rows: [{ x, y, n, axis?, kind?, pitch?, h?, tip? }]  0.1" header rows (axis "x" default);
//         kind "pins" (default) = plastic + gold pins up to z = tip (default dims.z),
//         kind "socket" = black female header h tall.

import * as THREE from "three";
import type { ModelBuilder } from "./types";
import { mat, GOLD, METAL, BLACK } from "./materials";
import { box, rbox, cylZ, finish, num, str } from "./shapes";

type F = Record<string, unknown>;
const PITCH = 2.54;
const DARK = "#15161a";
const BLUE = "#2f5fd0";

function paint(f: F, fallback = DARK): THREE.MeshStandardMaterial {
  const m = str(f.m, "");
  if (m === "metal") return METAL();
  if (m === "gold") return GOLD();
  if (m === "black") return BLACK();
  return mat(str(f.c, fallback), { roughness: num(f.rough, 0.5), metalness: num(f.metalness, 0) });
}

export const moduleBoard: ModelBuilder = ({ part, params }) => {
  const { z: dz } = part.dims;
  const g = new THREE.Group();
  const t = num(params.boardT, 1.6);
  const z0 = num(params.boardZ, 0);
  const bw = num(params.boardW, part.dims.x);
  const bd = num(params.boardD, part.dims.y);
  const bx = num(params.boardX, 0);
  const by = num(params.boardY, 0);
  const top = z0 + t;

  g.add(rbox("pcb", bw, bd, t, num(params.r, 1), bx, by, z0, mat(part.look.body), 2));

  for (const [i, h] of (part.mount?.holes ?? []).entries()) {
    g.add(cylZ(`mount_hole_${i + 1}`, h.d / 2 + 0.5, h.d / 2 + 0.5, 0.05, h.x, h.y, top, METAL(), 14));
    g.add(cylZ(`mount_hole_${i + 1}_bore`, h.d / 2, h.d / 2, 0.06, h.x, h.y, top, mat("#101114"), 14));
  }

  const feats = Array.isArray(params.feats) ? (params.feats as F[]) : [];
  feats.forEach((f, i) => {
    const k = str(f.t, "box");
    const x = num(f.x, 0);
    const y = num(f.y, 0);
    const z = num(f.z, top);
    const name = `${k}_${i + 1}`;
    const side = num(f.side, -1) < 0 ? -1 : 1;
    const ex = bx + (side * bw) / 2; // x of the PCB edge on that side
    switch (k) {
      case "box":
        g.add(box(name, num(f.w, 2), num(f.d, 2), num(f.h, 1), x, y, z, paint(f)));
        break;
      case "cyl":
        g.add(cylZ(name, num(f.r, 1), num(f.r, 1), num(f.h, 1), x, y, z, paint(f), num(f.seg, 20)));
        break;
      case "led": {
        const c = str(f.c, "#35d07f");
        g.add(box(name, 1.6, 0.8, 0.5, x, y, z, mat(c, { emissive: c, emissiveIntensity: 0.6 })));
        break;
      }
      case "usbc":
        g.add(box(name, 7.3, 8.9, 3.2, ex - side * 3.65, y, z, METAL()));
        g.add(box(`${name}_slot`, 0.1, 7, 1.2, ex - side * 0.06, y, z + 1, mat("#0a0a0b")));
        g.add(box(`${name}_tongue`, 0.1, 6, 0.5, ex - side * 0.07, y, z + 1.35, mat("#2b2b2e")));
        break;
      case "micro":
        g.add(box(name, 5.6, 7.5, 2.7, ex - side * 2.8, y, z, METAL()));
        g.add(box(`${name}_port`, 0.1, 5.8, 1.4, ex - side * 0.06, y, z + 0.7, mat("#101114")));
        break;
      case "mini":
        g.add(box(name, 9, 7.7, 3.9, ex - side * 4.5, y, z, METAL()));
        g.add(box(`${name}_port`, 0.1, 6, 2.2, ex - side * 0.06, y, z + 0.9, mat("#101114")));
        break;
      case "screw": {
        const n = Math.max(1, Math.round(num(f.n, 2)));
        const pitch = num(f.pitch, 5.08);
        const h = num(f.h, 10);
        const alongY = str(f.axis, "y") === "y";
        const len = n * pitch;
        g.add(box(name, alongY ? 8 : len, alongY ? len : 8, h, x, y, z, mat(BLUE, { roughness: 0.45 })));
        for (let j = 0; j < n; j++) {
          const o = -len / 2 + pitch * (j + 0.5);
          g.add(cylZ(`${name}_screw_${j + 1}`, 1.7, 1.7, 0.3, alongY ? x : x + o, alongY ? y + o : y, z + h, GOLD(), 12));
          g.add(box(`${name}_wire_${j + 1}`, alongY ? 0.2 : 3.4, alongY ? 3.4 : 0.2, 3.4, alongY ? x + 3.9 : x + o, alongY ? y + o : y + 3.9, z + 1.6, DARKMAT()));
        }
        break;
      }
      case "pot":
        g.add(box(name, 6, 6, 4.5, x, y, z, mat(BLUE, { roughness: 0.45 })));
        g.add(cylZ(`${name}_screw`, 1.7, 1.7, 0.6, x, y, z + 4.5, GOLD(), 12));
        break;
      case "pads": {
        const n = Math.max(1, Math.round(num(f.n, 2)));
        const pitch = num(f.pitch, 3.4);
        const alongY = str(f.axis, "y") === "y";
        for (let j = 0; j < n; j++) {
          const o = (j - (n - 1) / 2) * pitch;
          g.add(box(`${name}_${j + 1}`, 2.2, 2.2, 0.12, alongY ? x : x + o, alongY ? y + o : y, z, GOLD()));
        }
        break;
      }
      case "jst":
        g.add(box(name, num(f.w, 6), num(f.d, 8), num(f.h, 6), x, y, z, mat("#ece9e0", { roughness: 0.5 })));
        g.add(box(`${name}_slot`, num(f.w, 6) - 2, num(f.d, 8) - 2, 0.1, x, y, z + num(f.h, 6), mat("#2a2a2e")));
        break;
      default:
        break;
    }
  });

  const rows = Array.isArray(params.rows) ? (params.rows as F[]) : [];
  rows.forEach((r, ri) => {
    const n = Math.max(1, Math.round(num(r.n, 1)));
    const pitch = num(r.pitch, PITCH);
    const len = n * pitch;
    const rx = num(r.x, 0);
    const ry = num(r.y, 0);
    const alongY = str(r.axis, "x") === "y";
    const sx = alongY ? PITCH : len;
    const sy = alongY ? len : PITCH;
    if (str(r.kind, "pins") === "socket") {
      g.add(box(`header_${ri + 1}`, sx, sy, num(r.h, 8.5), rx, ry, top, BLACK()));
      return;
    }
    const plasticH = 2.5;
    g.add(box(`header_${ri + 1}`, sx, sy, plasticH, rx, ry, top, BLACK()));
    const pinH = num(r.tip, dz) - top - plasticH;
    for (let i = 0; i < n; i++) {
      const o = -len / 2 + pitch * (i + 0.5);
      g.add(box(`pin_${ri + 1}_${i + 1}`, 0.64, 0.64, pinH, alongY ? rx : rx + o, alongY ? ry + o : ry, top + plasticH, GOLD()));
    }
  });
  return finish(g, part.id);
};

function DARKMAT() {
  return mat("#1a1b1e", { roughness: 0.7 });
}

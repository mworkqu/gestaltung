// "Try it" (P5-17g) — what moves in the 3D tab while the behaviour preview runs.
//
// Built imperatively on the part models the 3D tab already shows (one group
// per instance, materials cloned per instance by the view), so nothing here
// touches another part or the shared wire materials:
//  * LED: the lens glows in its own colour + a soft additive halo sprite;
//  * WS2812 ring: the lit pixels take the ring colour + a halo in the middle;
//  * pump: a short arc of water drops out of the outlet;
//  * motor: the shaft spins with a small flag on it (else a rotor disc on top);
//  * servo: the horn turns to the angle;
//  * buzzer / speaker: rings pulse out of the sound hole / cone;
//  * relay: a status light on the board;
//  * OLED / LCD: the reading on its screen (CanvasTexture).
// No point lights (a new light recompiles every material), no bloom. Under
// reduced motion every state is shown standing still (drops and rings frozen,
// nothing spins, the servo jumps to its angle).
//
// Also the "flow" on active signal wires: small bright beads travelling along
// the wire's centre line (one InstancedMesh for all of them).
//
// Everything added is removed again by dispose(), and every changed material /
// pose is put back. Loaded only inside the lazy 3D chunk.

import * as THREE from "three";

import type { LibraryPart } from "@/lib/studio/schema";
import type { SimOutput } from "@/lib/studio/sim/model";
import type { OutputState, SimState } from "@/lib/studio/sim/step";
import type { Vec3 } from "@/lib/studio/wiring3d/pins3d";

export type SimFrame = {
  state: SimState;
  /** Connection ids with a signal right now. */
  active: Set<string>;
  /** Screen text per screen output id. */
  texts: Map<string, string>;
  reduced: boolean;
  rtl: boolean;
};

const noRaycast: THREE.Object3D["raycast"] = () => undefined;

// ── Shared resources (made once, kept for the page) ────────────────────────

let haloTex: THREE.Texture | null = null;
/** Soft round glow, white → transparent (tinted by the sprite colour). */
function haloTexture(): THREE.Texture {
  if (haloTex) return haloTex;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.25, "rgba(255,255,255,0.55)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  haloTex = new THREE.CanvasTexture(c);
  haloTex.colorSpace = THREE.SRGBColorSpace;
  return haloTex;
}

let dropGeo: THREE.SphereGeometry | null = null;
let ringGeo: THREE.RingGeometry | null = null;
let beadGeo: THREE.SphereGeometry | null = null;

function halo(colour: string, size: number): THREE.Sprite {
  const s = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: haloTexture(), color: colour, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
  );
  s.scale.set(size, size, 1);
  s.raycast = noRaycast;
  s.renderOrder = 5;
  return s;
}

/** A mesh's box in its parent's frame (the model group). */
function localBox(m: THREE.Mesh): THREE.Box3 {
  m.geometry.computeBoundingBox();
  m.updateMatrix();
  return m.geometry.boundingBox!.clone().applyMatrix4(m.matrix);
}

function meshes(g: THREE.Object3D, test: (name: string) => boolean): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && test(o.name)) out.push(o as THREE.Mesh);
  });
  return out;
}

type Std = THREE.MeshStandardMaterial;
const stdOf = (m: THREE.Mesh): Std | null => {
  const mat = Array.isArray(m.material) ? m.material[0] : m.material;
  return mat && (mat as Std).isMeshStandardMaterial ? (mat as Std) : null;
};

/** Moves meshes under a pivot (a group at `at`) without moving them on screen. */
function pivotAround(group: THREE.Object3D, list: THREE.Mesh[], at: THREE.Vector3): { pivot: THREE.Group; undo: () => void } {
  const pivot = new THREE.Group();
  pivot.position.copy(at);
  group.add(pivot);
  const parents = list.map((m) => m.parent);
  for (const m of list) {
    m.position.sub(at);
    pivot.add(m);
  }
  return {
    pivot,
    undo: () => {
      pivot.rotation.set(0, 0, 0);
      list.forEach((m, i) => {
        m.position.add(at);
        (parents[i] ?? group).add(m);
      });
      group.remove(pivot);
    },
  };
}

// ── One animator per output ─────────────────────────────────────────────────

/** apply() returns true while it still needs frames to settle (a servo on its way). */
type Animator = { apply: (o: OutputState, f: SimFrame, dt: number) => boolean | void; dispose: () => void };

function ledAnimator(g: THREE.Group, part: LibraryPart, out: SimOutput): Animator {
  const lens = meshes(g, (n) => n === "lens_dome" || n === "barrel" || n === "flange");
  const saved = lens.map((m) => {
    const s = stdOf(m);
    return s ? { s, e: s.emissive.clone(), i: s.emissiveIntensity } : null;
  });
  const colour = out.colour ?? "#ff3b30";
  const h = halo(colour, 16);
  h.position.set(0, 0, part.dims.z - 1.5);
  g.add(h);
  return {
    apply: (o) => {
      for (const x of saved) {
        if (!x) continue;
        x.s.emissive.set(colour);
        x.s.emissiveIntensity = o.on ? 0.6 + 2.4 * o.level : 0.04;
      }
      h.visible = o.on;
      const k = 10 + 10 * o.level;
      h.scale.set(k, k, 1);
    },
    dispose: () => {
      for (const x of saved) {
        if (!x) continue;
        x.s.emissive.copy(x.e);
        x.s.emissiveIntensity = x.i;
      }
      g.remove(h);
      h.material.dispose();
    },
  };
}

function ringAnimator(g: THREE.Group, part: LibraryPart): Animator {
  const glows = meshes(g, (n) => /^led_\d+_glow$/.test(n)).sort(
    (a, b) => Number(a.name.match(/\d+/)![0]) - Number(b.name.match(/\d+/)![0]),
  );
  const originals = glows.map((m) => ({ m, mat: m.material, scale: m.scale.clone() }));
  const mats = glows.map(() => new THREE.MeshStandardMaterial({ color: "#222", emissive: "#000", emissiveIntensity: 1, toneMapped: false }));
  glows.forEach((m, i) => {
    m.material = mats[i];
  });
  const h = halo("#ffffff", part.dims.x * 1.5);
  h.position.set(0, 0, part.dims.z + 0.5);
  g.add(h);
  return {
    apply: (o) => {
      const lit = o.pixels ?? 0;
      glows.forEach((m, i) => {
        const on = o.on && i < lit;
        mats[i].color.set(on ? o.colour ?? "#ffffff" : "#2a2a2a");
        mats[i].emissive.set(on ? o.colour ?? "#ffffff" : "#000000");
        mats[i].emissiveIntensity = on ? 2.2 : 0;
        m.scale.set(on ? 1.9 : 1, on ? 1.9 : 1, 1);
      });
      h.visible = o.on && lit > 0;
      (h.material as THREE.SpriteMaterial).color.set(o.colour ?? "#ffffff");
      const k = part.dims.x * (0.9 + 0.7 * (glows.length ? lit / glows.length : 1));
      h.scale.set(k, k, 1);
    },
    dispose: () => {
      for (const x of originals) {
        x.m.material = x.mat;
        x.m.scale.copy(x.scale);
      }
      for (const m of mats) m.dispose();
      g.remove(h);
      h.material.dispose();
    },
  };
}

const DROPS = 9;
function pumpAnimator(g: THREE.Group, part: LibraryPart): Animator {
  const outlet = meshes(g, (n) => n === "outlet")[0];
  const b = outlet ? localBox(outlet) : null;
  const x0 = b ? (b.min.x + b.max.x) / 2 : part.dims.x / 2 - 4;
  const y0 = b ? (b.min.y + b.max.y) / 2 : 0;
  const z0 = b ? b.max.z : part.dims.z;
  dropGeo ??= new THREE.SphereGeometry(1, 10, 8);
  const mat = new THREE.MeshStandardMaterial({ color: "#5aa9ff", emissive: "#2b7de9", emissiveIntensity: 0.35, roughness: 0.15, transparent: true, opacity: 0.88 });
  const drops: THREE.Mesh[] = [];
  const grp = new THREE.Group();
  for (let i = 0; i < DROPS; i++) {
    const d = new THREE.Mesh(dropGeo, mat);
    d.raycast = noRaycast;
    grp.add(d);
    drops.push(d);
  }
  g.add(grp);
  let phase = 0;
  return {
    apply: (o, f, dt) => {
      grp.visible = o.on;
      if (!o.on) return;
      if (!f.reduced) phase = (phase + dt * (0.9 + 0.8 * o.level)) % 1;
      drops.forEach((d, i) => {
        const u = (phase + i / DROPS) % 1;
        // A small fountain arc: up out of the nozzle, over and down.
        d.position.set(x0 + u * 16, y0, z0 + 13 * u - 16 * u * u);
        const s = 0.7 + 0.5 * Math.sin(Math.PI * u);
        d.scale.setScalar(s);
      });
    },
    dispose: () => {
      g.remove(grp);
      mat.dispose();
    },
  };
}

function motorAnimator(g: THREE.Group, part: LibraryPart): Animator {
  const shaft = meshes(g, (n) => n === "shaft" || n === "shaft_flat");
  const flagMat = new THREE.MeshStandardMaterial({ color: "#f97316", roughness: 0.5 });
  if (shaft.length) {
    const b = new THREE.Box3();
    for (const m of shaft) b.union(localBox(m));
    const at = new THREE.Vector3((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2);
    const { pivot, undo } = pivotAround(g, shaft, at);
    // A little flag at the shaft tip, so the turn is easy to see.
    const flag = new THREE.Mesh(new THREE.BoxGeometry(1, 9, 1.4), flagMat);
    flag.position.set(b.max.x - at.x - 0.6, 0, 0);
    flag.raycast = noRaycast;
    pivot.add(flag);
    return {
      apply: (o, f, dt) => {
        flag.visible = true;
        if (o.on && !f.reduced) pivot.rotation.x = (pivot.rotation.x + dt * (8 + 22 * o.level)) % (Math.PI * 2);
      },
      dispose: () => {
        pivot.remove(flag);
        flag.geometry.dispose();
        flagMat.dispose();
        undo();
      },
    };
  }
  // No named shaft: a small rotor disc on top.
  const rotor = new THREE.Mesh(new THREE.BoxGeometry(Math.min(part.dims.x, part.dims.y) * 0.8, 2, 1), flagMat);
  rotor.position.set(0, 0, part.dims.z + 1);
  rotor.raycast = noRaycast;
  g.add(rotor);
  return {
    apply: (o, f, dt) => {
      if (o.on && !f.reduced) rotor.rotation.z = (rotor.rotation.z + dt * (8 + 22 * o.level)) % (Math.PI * 2);
    },
    dispose: () => {
      g.remove(rotor);
      rotor.geometry.dispose();
      flagMat.dispose();
    },
  };
}

function servoAnimator(g: THREE.Group): Animator {
  const horn = meshes(g, (n) => n.startsWith("horn_"));
  const shaft = meshes(g, (n) => n === "shaft")[0] ?? horn[0];
  if (!horn.length || !shaft) return { apply: () => undefined, dispose: () => undefined };
  const b = localBox(shaft);
  const at = new THREE.Vector3((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, 0);
  const { pivot, undo } = pivotAround(g, horn, at);
  let cur = 0;
  return {
    apply: (o, f, dt) => {
      const goal = o.angle ?? 0;
      cur = f.reduced ? goal : cur + (goal - cur) * Math.min(1, dt * 14);
      if (Math.abs(goal - cur) < 0.2) cur = goal;
      pivot.rotation.z = (cur * Math.PI) / 180;
      return cur !== goal;
    },
    dispose: undo,
  };
}

function soundAnimator(g: THREE.Group, part: LibraryPart, kind: "buzzer" | "speaker"): Animator {
  const src = meshes(g, (n) => n === "spk_cone" || n === "sound_hole")[0];
  const b = src ? localBox(src) : null;
  const cx = b ? (b.min.x + b.max.x) / 2 : 0;
  const cy = b ? (b.min.y + b.max.y) / 2 : 0;
  const r0 = kind === "speaker" ? 9 : 6;
  ringGeo ??= new THREE.RingGeometry(0.86, 1, 40);
  const mats: THREE.MeshBasicMaterial[] = [];
  const rings: THREE.Mesh[] = [];
  const grp = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const m = new THREE.MeshBasicMaterial({ color: kind === "speaker" ? "#22d3ee" : "#60a5fa", transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    const r = new THREE.Mesh(ringGeo, m);
    r.raycast = noRaycast;
    r.renderOrder = 4;
    grp.add(r);
    rings.push(r);
    mats.push(m);
  }
  grp.position.set(cx, cy, part.dims.z + 0.6);
  g.add(grp);
  let phase = 0;
  return {
    apply: (o, f, dt) => {
      grp.visible = o.on;
      if (!o.on) return;
      if (!f.reduced) phase = (phase + dt * (0.35 + 0.18 * (o.beepHz ?? 2))) % 1;
      rings.forEach((r, i) => {
        const u = f.reduced ? (i + 1) / 4 : (phase + i / 3) % 1;
        const s = r0 * (1 + 2.2 * u);
        r.scale.set(s, s, 1);
        mats[i].opacity = 0.85 * (1 - u);
      });
    },
    dispose: () => {
      g.remove(grp);
      for (const m of mats) m.dispose();
    },
  };
}

function relayAnimator(g: THREE.Group, part: LibraryPart): Animator {
  const mat = new THREE.MeshStandardMaterial({ color: "#3b0d0d", emissive: "#ef4444", emissiveIntensity: 0, roughness: 0.3 });
  const dot = new THREE.Mesh(new THREE.SphereGeometry(1.3, 12, 10), mat);
  dot.position.set(part.dims.x / 2 - 4, part.dims.y / 2 - 3.5, 2.6);
  dot.raycast = noRaycast;
  const h = halo("#ff4d4d", 9);
  h.position.copy(dot.position).add(new THREE.Vector3(0, 0, 1));
  g.add(dot, h);
  return {
    apply: (o) => {
      mat.emissiveIntensity = o.on ? 3 : 0;
      mat.color.set(o.on ? "#ff6b6b" : "#3b0d0d");
      h.visible = o.on;
    },
    dispose: () => {
      g.remove(dot, h);
      dot.geometry.dispose();
      mat.dispose();
      h.material.dispose();
    },
  };
}

function screenAnimator(g: THREE.Group, out: SimOutput): Animator {
  const lcd = out.partId.startsWith("lcd");
  const face = meshes(g, (n) => n === "active_area")[0] ?? meshes(g, (n) => n === "glass")[0];
  if (!face) return { apply: () => undefined, dispose: () => undefined };
  const canvas = document.createElement("canvas");
  canvas.width = lcd ? 512 : 256;
  canvas.height = lcd ? 112 : 128;
  const ctx = canvas.getContext("2d")!;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const before = face.material;
  const mat = new THREE.MeshStandardMaterial({ color: "#000000", emissive: "#ffffff", emissiveMap: tex, emissiveIntensity: 1, roughness: 0.25 });
  face.material = mat;
  let last = "";
  return {
    apply: (_o, f) => {
      const text = f.texts.get(out.id) ?? "";
      const key = `${text}|${f.rtl}`;
      if (key === last) return;
      last = key;
      ctx.fillStyle = lcd ? "#1f55d6" : "#000000";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = lcd ? "#f2f6ff" : "#bdf3ff";
      ctx.textBaseline = "middle";
      ctx.direction = f.rtl ? "rtl" : "ltr";
      ctx.textAlign = "center";
      let size = lcd ? 54 : 34;
      ctx.font = `600 ${size}px system-ui, sans-serif`;
      while (size > 12 && ctx.measureText(text).width > canvas.width - 16) {
        size -= 2;
        ctx.font = `600 ${size}px system-ui, sans-serif`;
      }
      ctx.fillText(text, canvas.width / 2, canvas.height / 2);
      tex.needsUpdate = true;
    },
    dispose: () => {
      face.material = before;
      mat.dispose();
      tex.dispose();
    },
  };
}

// ── The rig ─────────────────────────────────────────────────────────────────

/** apply() returns true while something still needs frames to settle. */
export type SimRig = { apply: (f: SimFrame, dt: number) => boolean; dispose: () => void };

export function createSimRig(models: Map<string, THREE.Group>, parts: Map<string, LibraryPart>, outputs: SimOutput[]): SimRig {
  const anims = new Map<string, Animator>();
  for (const out of outputs) {
    const g = models.get(out.id);
    const part = parts.get(out.id);
    if (!g || !part) continue;
    try {
      const a =
        out.kind === "led"
          ? ledAnimator(g, part, out)
          : out.kind === "ring"
            ? ringAnimator(g, part)
            : out.kind === "pump"
              ? pumpAnimator(g, part)
              : out.kind === "motor"
                ? motorAnimator(g, part)
                : out.kind === "servo"
                  ? servoAnimator(g)
                  : out.kind === "buzzer" || out.kind === "speaker"
                    ? soundAnimator(g, part, out.kind)
                    : out.kind === "relay"
                      ? relayAnimator(g, part)
                      : screenAnimator(g, out);
      anims.set(out.id, a);
    } catch (err) {
      console.warn("[studio sim] animator failed", out.id, err);
    }
  }
  return {
    apply: (f, dt) => {
      let busy = false;
      for (const o of f.state.outputs) if (anims.get(o.id)?.apply(o, f, dt)) busy = true;
      return busy;
    },
    dispose: () => {
      for (const a of anims.values()) a.dispose();
      anims.clear();
    },
  };
}

// ── Flow beads along active wires ──────────────────────────────────────────

const MAX_BEADS = 700;
const BEAD_GAP = 7;
const BEAD_SPEED = 26;

export type FlowWire = { id: string; shared?: string[]; colour: string; points: Vec3[]; hidden?: boolean };

export function createFlow(radius: number): {
  mesh: THREE.InstancedMesh;
  update: (wires: FlowWire[], f: SimFrame | null, t: number) => void;
  dispose: () => void;
} {
  beadGeo ??= new THREE.SphereGeometry(1, 10, 8);
  const mat = new THREE.MeshBasicMaterial({ color: "#ffffff", toneMapped: false });
  const mesh = new THREE.InstancedMesh(beadGeo, mat, MAX_BEADS);
  mesh.raycast = noRaycast;
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  const white = new THREE.Color("#ffffff");
  const col = new THREE.Color();
  mesh.setColorAt(0, white); // creates the colour buffer before the first compile
  mesh.count = 0;
  const m4 = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3(radius, radius, radius);
  const lens = new WeakMap<Vec3[], number[]>();
  const cumulative = (pts: Vec3[]) => {
    let c = lens.get(pts);
    if (!c) {
      c = [0];
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        c.push(c[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
      }
      lens.set(pts, c);
    }
    return c;
  };
  return {
    mesh,
    update: (wires, f, t) => {
      let n = 0;
      if (f && f.active.size) {
        const off = f.reduced ? BEAD_GAP / 2 : (t * BEAD_SPEED) % BEAD_GAP;
        for (const w of wires) {
          if (w.hidden || w.points.length < 2) continue;
          if (!f.active.has(w.id) && !w.shared?.some((id) => f.active.has(id))) continue;
          const c = cumulative(w.points);
          const total = c[c.length - 1];
          col.set(w.colour).lerp(white, w.colour === "#1c2434" ? 0.55 : 0.6);
          let seg = 1;
          for (let d = off; d < total && n < MAX_BEADS; d += BEAD_GAP) {
            while (seg < c.length - 1 && c[seg] < d) seg++;
            const a = w.points[seg - 1];
            const b = w.points[seg];
            const span = c[seg] - c[seg - 1] || 1;
            const k = (d - c[seg - 1]) / span;
            p.set(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k);
            m4.compose(p, q, s);
            mesh.setMatrixAt(n, m4);
            mesh.setColorAt(n, col);
            n++;
          }
        }
      }
      mesh.count = n;
      mesh.visible = n > 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    },
    dispose: () => {
      mat.dispose();
      mesh.dispose();
    },
  };
}

// Messages between the main thread (geometry/client.ts) and the geometry
// worker (studio-geometry.worker.ts → job.ts). Plain data only.

import type { EnclosureMeta } from "../enclosure/plan";
import type { Vec3 } from "../explode";
import type { LayoutResult } from "../layout";
import type { MechTemplate, EnclosureSpec, Environment, LibraryPart, MechPart } from "../schema";
import type { Material } from "../mech/materials";
import type { PackedGeometry } from "./pack";
import type { PrintCheck } from "./mesh-check";
import type { BuiltLink, BuiltPiece } from "./product-kernel";
import type { PlacedElectronic, SolvedProduct } from "../product/solve";
import type { Archetype, Scene } from "../product/schema";
import type { SceneMetrics } from "../product/scene";
import type { ProductSpec } from "../schema";

export type EnclosureInput = {
  spec: EnclosureSpec;
  layout: LayoutResult;
  /** [instanceId, part] pairs (a Map does not survive every clone path). */
  parts: [string, LibraryPart][];
};

export type MechInput = EnclosureInput & { mech: MechPart[]; environment?: Environment };

export type PackedEnclosure = {
  base: PackedGeometry;
  lid: PackedGeometry;
  /** Rubber feet (children of the base; geometry already in base coords). */
  feet: { name: string; geometry: PackedGeometry }[];
  /** The plan (dims, settled layout, openings, label) the shell was cut for. */
  meta: EnclosureMeta;
};

export type PackedMechPart = {
  id: string;
  template: MechTemplate;
  name: { en: string; ar: string };
  explode: Vec3;
  printable: { material: Material; estGrams: number };
  volumeMm3: number;
  triangles: number;
  /** F-003: the manifold check, run in the worker on the mesh we would export. */
  check: PrintCheck;
  /** Outer size in the print pose (mm). */
  size: { w: number; d: number; h: number };
  /** lid / base: the enclosure's own geometry is reused on the main thread. */
  shell?: "lid" | "base";
  geometry?: PackedGeometry;
  position: Vec3;
  rotation: Vec3;
};

/** P5-16 product build. geometry false = metadata only (nothing to draw leaves the worker). */
export type ProductInput = { solved: SolvedProduct; geometry: boolean };

type MeshArrays = { positions: Float32Array; normals: Float32Array; indices: Uint32Array };
type MetaOf<T> = Omit<T, keyof MeshArrays> & Partial<MeshArrays>;

/** A built product as it crosses postMessage (arrays only when geometry was asked for). */
export type PackedProduct = {
  hash: string;
  ms: number;
  geometry: boolean;
  pieces: MetaOf<BuiltPiece>[];
  links: MetaOf<BuiltLink>[];
  electronics: PlacedElectronic[];
  bbox: SolvedProduct["bbox"];
};

export type ProductRequest = { id: number; kind: "product"; key: string; input: ProductInput };

// ---------------------------------------------------------------------------
// P5-16 Phase 2b: preview pictures, "Create my CAD", per-body STLs.
// The worker talks to /api/studio/product/* itself (same-origin, cookies); the
// page gets ONLY pictures, progress and page-safe metadata before payment.
// ---------------------------------------------------------------------------

/** e2e fixture only (E2E_FIXTURES): the worker answers the product endpoints itself, no network. */
export type ProductMockOptions = {
  /** Fixed vision score (default 8). */
  score?: number;
  /** Design builds allowed before "guest_limit" (null = no limit). */
  guestLimitAfter?: number | null;
  /** Every design fails (tests the template fallback). */
  fail?: boolean;
  /**
   * ?productremote=1: the endpoints go over the network to the fixed test path
   * /__e2e/studio-product instead (a Playwright harness answers them, e.g. with the
   * real designer + vision check run in node). Nothing on the server answers it.
   */
  remote?: boolean;
};

type ProductCommon = {
  projectId: string;
  /** The spec + parts the page already has (the solver needs them; never secret). */
  spec: ProductSpec;
  /** [instanceId, part] pairs. */
  parts: [string, LibraryPart][];
  /** "/api/studio/product" on the live site. */
  apiBase: string;
  mock?: ProductMockOptions | null;
};

export type ProductPreviewInput = ProductCommon & {
  count: number;
  exclude?: Archetype[];
  /** What the visitor says is wrong with the designs shown: steers a NEW set (a regeneration). */
  feedback?: string;
};
export type ProductUnlockInput = ProductCommon & { designId: string };
/** STL files of a product already built in this worker (after unlock). */
export type ProductStlInput = { hash: string; name: string };

export type ProductStage = "designing" | "checking" | "polishing";
export type ProductWhy = { en: string; ar: string };

/** Streamed while a productPreview runs. NEVER carries a model or geometry. */
export type ProductEvent =
  | { kind: "productProgress"; stage: ProductStage; designId?: string; index?: number; total?: number }
  | {
      kind: "productPicture";
      designId: string;
      archetype: Archetype;
      why: ProductWhy;
      previewPath: string | null;
      /** PNG bytes (3/4 view in its scene, ≤ 1024 px), transferred. */
      png: ArrayBuffer;
      ms: number;
    };

export type ProductPreviewDesign = {
  id: string;
  archetype: Archetype;
  why: ProductWhy;
  previewPath: string | null;
  status: "ready" | "failed";
};
export type ProductPreviewError = "guest_limit" | "sign_in" | "no_tokens" | "no_render" | "failed";
export type ProductPreviewResult = {
  designs: ProductPreviewDesign[];
  error?: ProductPreviewError;
  /** Why it failed, when the job can tell (F-009); only set together with error "failed". */
  reason?: "network" | "setup" | "service" | "pictures";
  ms: number;
  /** Regenerations made on the project so far (set by the server on a regeneration; the first is free). */
  regens?: number;
};

/** After payment only: the built product with geometry, and what the viewer needs for the scene. */
export type ProductUnlockResult = PackedProduct & { designId: string; scene: Scene; stage: SceneMetrics };

export type ProductStlFile = {
  id: string;
  bodyId: string;
  piece: "whole" | "bottom" | "top";
  role: string;
  material: string;
  grams: number;
  name: string;
  data: ArrayBuffer;
};
export type ProductStlResult = {
  files: ProductStlFile[];
  /**
   * F-003: one file per BED, laid out inside the printer's envelope. The old
   * single "all parts" file was 406 mm long and did not fit the MK4.
   */
  plates: { name: string; data: ArrayBuffer; w: number; d: number }[];
  /** Kept so older callers still compile: the first plate, or null. */
  combined: { name: string; data: ArrayBuffer } | null;
  /**
   * Bodies we refused to export because they failed the manifold check
   * (F-003: never hand over a mesh a slicer cannot fill).
   */
  unclosed: { id: string; role: string; shells: number }[];
  /** Bodies that do not fit the bed at all, so no plate holds them. */
  tooBig: string[];
};

// ---------------------------------------------------------------------------
// Parts step picture: the picked parts on their plate, drawn in the worker so the
// page needs no 3D engine before "Create my CAD". Only PNG bytes + where each part
// sits on the picture (0–1, for tap targets) come back.
// ---------------------------------------------------------------------------

export type PartsPictureInput = {
  /** [instanceId, part] pairs, in list order. */
  parts: [string, LibraryPart][];
  /** Picture size in px (the page asks for its box × device pixel ratio, capped). */
  width: number;
  height: number;
  /** Plate rim colour (the Parts step accent). */
  accent: string;
};
export type PartsPictureSpot = { instanceId: string; x: number; y: number };
/**
 * The picture is a turntable: the parts turn once around the vertical axis (with their
 * gentle bob) in `total` small pictures. Each frame is STREAMED as a PartsFrameEvent
 * (frame 0 first, as soon as it is drawn); the reply only closes the request.
 */
export type PartsFrameEvent = {
  kind: "partsFrame";
  index: number;
  total: number;
  /** WebP where the browser can encode it (else PNG), transferred. */
  bytes: ArrayBuffer;
  mime: string;
  width: number;
  height: number;
  /** Where each part's centre lands on THIS frame (0-1), for tap targets. */
  spots: PartsPictureSpot[];
};
export type PartsPictureResult = { width: number; height: number; frames: number; bytes: number; mime: string };

export type GeometryRequest =
  | { id: number; kind: "enclosure"; key: string; input: EnclosureInput }
  | { id: number; kind: "mech"; key: string; encKey: string; input: MechInput }
  | ProductRequest
  | { id: number; kind: "productPreview"; input: ProductPreviewInput }
  | { id: number; kind: "productUnlocked"; input: ProductUnlockInput }
  | { id: number; kind: "productStl"; input: ProductStlInput }
  | { id: number; kind: "partsPicture"; input: PartsPictureInput };

export type GeometryReply =
  | { id: number; ok: true; kind: "enclosure"; result: PackedEnclosure; ms: number }
  | { id: number; ok: true; kind: "mech"; result: PackedMechPart[]; ms: number }
  | { id: number; ok: true; kind: "product"; result: PackedProduct; ms: number }
  | { id: number; ok: true; kind: "productPreview"; result: ProductPreviewResult; ms: number }
  | { id: number; ok: true; kind: "productUnlocked"; result: ProductUnlockResult; ms: number }
  | { id: number; ok: true; kind: "productStl"; result: ProductStlResult; ms: number }
  | { id: number; ok: true; kind: "partsPicture"; result: PartsPictureResult; ms: number }
  | { id: number; ok: false; error: string };

/** A progress message for a running request (not its reply). */
export type GeometryEvent = { id: number; event: ProductEvent | PartsFrameEvent };

export type WorkerMessage = GeometryReply | GeometryEvent;

export function isGeometryEvent(m: WorkerMessage): m is GeometryEvent {
  return typeof m === "object" && m !== null && "event" in m;
}

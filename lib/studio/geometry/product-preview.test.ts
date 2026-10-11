import { beforeEach, describe, expect, it } from "vitest";
import * as THREE from "three";

import { stableHash } from "../cache";
import { GOLDEN_IDEAS, goldenParts } from "../product/__fixtures__/golden";
import { defaultProductFor } from "../product/archetypes";
import type { SolvedProduct } from "../product/solve";
import { buildSceneProps } from "../product/scene/props";
import { SCENES } from "../product/schema";
import { productSpecHash } from "../product/spec-hash";
import { mockProductHttp, resetProductMock } from "./product-mock";
import { bytesToBase64, loadUnlockedProduct, MAX_LOOPS, productStlFiles, runProductPreview, type Http, type PreviewDeps } from "./product-preview";
import type { BuiltProduct } from "./product-kernel";
import type { ProductEvent, ProductPreviewInput } from "./protocol";

const plant = GOLDEN_IDEAS[0];
const parts = goldenParts(plant);
const input: ProductPreviewInput = {
  projectId: "p1",
  count: 3,
  spec: plant.spec,
  parts: parts.map((p) => [p.instanceId, p.part]),
  apiBase: "/api/studio/product",
};

/** A tetrahedron "piece" (enough for STL / render plumbing). */
function fakeBuilt(solved: SolvedProduct): BuiltProduct {
  const positions = new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 10]);
  const indices = new Uint32Array([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3]);
  const piece = {
    id: "head",
    bodyId: "head",
    piece: "whole" as const,
    role: "housing" as const,
    material: "PLA" as const,
    colour: "chalk" as const,
    colourHex: "#f2f0eb",
    finish: "matte_plastic" as const,
    positions,
    normals: new Float32Array(12),
    indices,
    triangles: 4,
    volumeMm3: 100,
    grams: 3,
    printable: true,
    print: { pose: "upright" as never, matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1], size: [10, 10, 10] as [number, number, number], fits: true, overhangDeg: 0 },
    explode: [0, 0, 5] as [number, number, number],
    watertight: true,
  };
  return { hash: solved.hash, pieces: [piece, { ...piece, id: "stake", bodyId: "stake", role: "stake" as const }], links: [], electronics: [], bbox: solved.bbox, ms: 1 };
}

function deps(http: Http, log: string[] = []): PreviewDeps {
  return {
    http: async (path, init) => {
      log.push(path);
      return http(path, init);
    },
    build: async (s) => fakeBuilt(s),
    render: async (_b, _s, shots) => shots.map((s) => new Uint8Array([s.size % 251, 1, 2]).buffer),
    canRender: () => true,
    now: () => 0,
  };
}

beforeEach(() => resetProductMock());

describe("runProductPreview (mock endpoints)", () => {
  it("designs 3 different archetypes and streams pictures, never a model", async () => {
    const events: ProductEvent[] = [];
    const r = await runProductPreview(input, (e) => events.push(e), deps(mockProductHttp(input, { score: 8 })));
    expect(r.error).toBeUndefined();
    expect(r.designs).toHaveLength(3);
    expect(new Set(r.designs.map((d) => d.archetype)).size).toBe(3);
    expect(r.designs[0].archetype).toBe("stake_device");
    const pics = events.filter((e) => e.kind === "productPicture");
    expect(pics).toHaveLength(3);
    // Nothing in any event is a model or geometry.
    for (const e of events) {
      expect(Object.keys(e)).not.toContain("model");
      expect(JSON.stringify({ ...e, png: undefined })).not.toMatch(/bodies|positions/);
    }
    expect(events.map((e) => (e.kind === "productProgress" ? e.stage : "picture"))).toContain("checking");
    expect(events.map((e) => (e.kind === "productProgress" ? e.stage : "picture"))).toContain("polishing");
  });

  it("try another excludes the archetypes already shown", async () => {
    const r = await runProductPreview({ ...input, exclude: ["stake_device", "planter_insert"] }, () => {}, deps(mockProductHttp(input, {})));
    expect(r.designs.map((d) => d.archetype)).not.toContain("stake_device");
    expect(r.designs.map((d) => d.archetype)).not.toContain("planter_insert");
  });

  it("guest limit → guest_limit, no designs", async () => {
    const r = await runProductPreview(input, () => {}, deps(mockProductHttp(input, { guestLimitAfter: 0 })));
    expect(r).toMatchObject({ designs: [], error: "guest_limit" });
  });

  it("no offscreen renderer → no_render (the page keeps the template flow)", async () => {
    const d = { ...deps(mockProductHttp(input, {})), canRender: () => false };
    expect((await runProductPreview(input, () => {}, d)).error).toBe("no_render");
  });

  it("server answers 409 / empty → failed", async () => {
    const http: Http = async () => ({ status: 409, data: { error: "no_parts" } });
    expect((await runProductPreview(input, () => {}, deps(http))).error).toBe("failed");
  });
});

describe("vision loop", () => {
  const model = defaultProductFor(plant.spec, parts);
  function scripted(scores: number[], changed = true): { http: Http; checks: number[] } {
    const checks: number[] = [];
    let i = 0;
    const http: Http = async (path, init) => {
      const body = (init.body ?? {}) as Record<string, unknown>;
      if (path === "/design") return { status: 200, data: { designs: [{ id: "d1", archetype: "stake_device", model, why: { en: "x", ar: "y" } }] } };
      if (path === "/check") {
        checks.push(Number(body.loop));
        const score = scores[Math.min(i++, scores.length - 1)];
        // A patched model: the head a little wider each loop.
        const next = structuredClone(model);
        return { status: 200, data: { score, changed, model: next, looksLike: "", missing: [] } };
      }
      if (path === "/preview") return { status: 200, data: { previewPath: `studio-previews/p1/d1.png`, loop: body.loop } };
      return { status: 404, data: {} };
    };
    return { http, checks };
  }

  it("stops at once when the score is good", async () => {
    const s = scripted([8]);
    await runProductPreview(input, () => {}, deps(s.http));
    expect(s.checks).toEqual([0]);
  });

  it("loops at most MAX_LOOPS more times while the score is low and the model changed", async () => {
    const s = scripted([3, 4, 5, 6]);
    await runProductPreview(input, () => {}, deps(s.http));
    expect(s.checks).toEqual([0, 1, 2]);
    expect(s.checks.length).toBe(1 + MAX_LOOPS);
  });

  it("does not loop when the check changed nothing", async () => {
    const s = scripted([3], false);
    await runProductPreview(input, () => {}, deps(s.http));
    expect(s.checks).toEqual([0]);
  });

  it("keeps the best-scoring loop for the picture", async () => {
    const s = scripted([4, 9]);
    const bodies: unknown[] = [];
    const base = deps(s.http);
    await runProductPreview(input, () => {}, {
      ...base,
      http: async (p, init) => {
        if (p === "/preview") bodies.push(init.body);
        return s.http(p, init);
      },
    });
    expect(s.checks).toEqual([0, 1]);
    expect(bodies[0]).toMatchObject({ loop: 1 });
  });

  it("a skipped check (quota / no key) keeps the model", async () => {
    const http: Http = async (path) => {
      if (path === "/design") return { status: 200, data: { designs: [{ id: "d1", archetype: "stake_device", model }] } };
      if (path === "/check") return { status: 200, data: { skipped: "quota", model } };
      if (path === "/preview") return { status: 503, data: { error: "storage_unavailable" } };
      return { status: 404, data: {} };
    };
    const events: ProductEvent[] = [];
    const r = await runProductPreview(input, (e) => events.push(e), deps(http));
    expect(r.designs[0]).toMatchObject({ status: "ready", previewPath: null });
    expect(events.some((e) => e.kind === "productPicture")).toBe(true);
  });
});

describe("unlock + STL", () => {
  it("GET /model after unlock builds the product; locked → throws", async () => {
    const http = mockProductHttp(input, {});
    await runProductPreview(input, () => {}, deps(http));
    const { solved, built } = await loadUnlockedProduct({ ...input, designId: "d_mkstakedevice" }, { http, build: async (s) => fakeBuilt(s) });
    expect(built.hash).toBe(solved.hash);
    const locked: Http = async () => ({ status: 403, data: { error: "locked" } });
    await expect(loadUnlockedProduct({ ...input, designId: "x" }, { http: locked, build: async (s) => fakeBuilt(s) })).rejects.toThrow("locked");
  });

  it("one STL per printable piece + a plate file", () => {
    const built = fakeBuilt({ hash: "h", bbox: { min: [0, 0, 0], max: [1, 1, 1] } } as SolvedProduct);
    const r = productStlFiles(built, "Plant Waterer");
    expect(r.files.map((f) => f.name)).toEqual(["Plant-Waterer-head.stl", "Plant-Waterer-stake.stl"]);
    expect(r.files[0].data.byteLength).toBe(84 + 4 * 50);
    expect(r.combined?.data.byteLength).toBe(84 + 8 * 50);
  });
});

describe("helpers", () => {
  it("base64", () => {
    expect(bytesToBase64(new Uint8Array([104, 105]).buffer)).toBe("aGk=");
  });

  it("spec hash ignores part order and labels", () => {
    const a = [
      { partId: "x", instanceId: "x_1" },
      { partId: "y", instanceId: "y_1" },
    ];
    expect(productSpecHash(plant.spec, a)).toBe(productSpecHash(plant.spec, [...a].reverse()));
    expect(productSpecHash(plant.spec, a)).not.toBe(productSpecHash(GOLDEN_IDEAS[1].spec, a));
    // The server's rule (lib/studio/server/product.ts): stableHash of { spec, sorted part ids }.
    expect(productSpecHash(plant.spec, a)).toBe(stableHash({ spec: plant.spec, parts: ["x", "y"] }));
  });

  it("every scene builds props (pot with soil and leaves for the plant)", () => {
    for (const scene of SCENES) {
      const p = buildSceneProps(scene, { groundZ: 0, floorZ: scene === "plant_pot" ? -110 : 0, wallY: 0, mountZ: 100, obstacles: [], pot: { radius: 75, wall: 6, rimAbove: 10, depth: 110 } }, { min: [-30, -30, -100], max: [30, 30, 80] });
      let meshes = 0;
      p.group.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) meshes++;
      });
      expect(meshes, scene).toBeGreaterThan(0);
      expect(p.focus, scene).not.toBeNull();
      p.dispose();
    }
  });
});

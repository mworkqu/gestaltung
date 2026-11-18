import { beforeEach, describe, expect, it, vi } from "vitest";

import { round2 } from "@/lib/format/money";
import { CODE_LIBRARY } from "@/lib/studio/library";
import { EXAMPLE_BUILD_FILE, parseBuildFile } from "./build-file";
import { checkProject, skusForDoc, storeSkusFor, type PluginProduct } from "./check-project";
import { pluginLibraryFrom } from "./to-studio";

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

const lib = pluginLibraryFrom(CODE_LIBRARY);
const skuOf = (id: string) => CODE_LIBRARY.getPart(id)!.storeSkus[0];

describe("checkProject", () => {
  it("prices the example from the store, with pack maths, and leaves the rest to source", () => {
    const build = parseBuildFile(EXAMPLE_BUILD_FILE);
    if (!build.ok) throw new Error("example must parse");
    const skus = storeSkusFor(build.value, lib);
    // Our rules' MOSFET switch is priced too, not only what the client named.
    expect(skus).toContain(skuOf("mosfet_module"));

    const products = new Map<string, PluginProduct>([
      // A pack of 10 for the one pump we need: one pack, the whole pack price.
      [skuOf("pump_5v"), { sku: skuOf("pump_5v"), name: "Mini water pump (10 Pack)", name_ar: null, unit_price: 45, pack_size: 10 }],
      [skuOf("soil_moisture_cap"), { sku: skuOf("soil_moisture_cap"), name: "Soil sensor", name_ar: null, unit_price: 12.5 }],
      [skuOf("mosfet_module"), { sku: skuOf("mosfet_module"), name: "MOSFET module", name_ar: null, unit_price: 9.99, min_order_qty: 2 }],
      // Listed but unpriced: we source it.
      [skuOf("motor_driver"), { sku: skuOf("motor_driver"), name: "Driver", name_ar: null, unit_price: null }],
    ]);
    const r = checkProject(EXAMPLE_BUILD_FILE, { lib, products });
    expect(r.ok, r.problems.join("; ")).toBe(true);
    expect(r.doc).not.toBeNull();

    const byId = new Map(r.parts.map((p) => [p.id, p]));
    expect(byId.get("pump_5v")).toMatchObject({ qty: 1, status: "in_store", price_qar: 45, sku: skuOf("pump_5v") });
    expect(byId.get("soil_moisture_cap")).toMatchObject({ status: "in_store", price_qar: 12.5 });
    // Minimum order 2 → two listings.
    expect(byId.get("mosfet_module")).toMatchObject({ status: "in_store", price_qar: 19.98 });
    expect(byId.get("esp32_c3_mini")).toMatchObject({ status: "we_source" });
    expect(byId.get("esp32_c3_mini")).not.toHaveProperty("price_qar");
    expect(byId.has("motor_driver")).toBe(false);

    const sum = round2(r.parts.reduce((s, p) => s + (p.status === "in_store" ? p.price_qar ?? 0 : 0), 0));
    expect(r.parts_total_qar).toBe(sum);
    expect(r.parts_total_qar).toBe(77.48);
    expect(r.wiring_summary).toMatch(/^\d+ connections on \d+ nets; \d+ parts? added by our rules; all checks passed$/);
    const json = JSON.stringify({ ...r, doc: null });
    expect(json).not.toMatch(/"(cost|margin|landed_cost_qar)"/);
    expect(skusForDoc(r.doc!, lib)).toEqual(expect.arrayContaining(skus));
  });

  it("invalid input → path errors, no doc", () => {
    const r = checkProject({ ...EXAMPLE_BUILD_FILE, parts: [], cad: {} }, { lib, products: new Map() });
    expect(r.ok).toBe(false);
    expect(r.doc).toBeNull();
    expect(r.problems.some((p) => p.startsWith("parts"))).toBe(true);
    expect(r.parts).toEqual([]);
  });

  it("an unknown part is a problem, not a crash", () => {
    const r = checkProject({ ...EXAMPLE_BUILD_FILE, parts: [{ library_id: "warp_core" }] }, { lib, products: new Map() });
    expect(r.ok).toBe(false);
    expect(r.doc).toBeNull();
    expect(r.problems[0]).toMatch(/warp_core/);
  });
});

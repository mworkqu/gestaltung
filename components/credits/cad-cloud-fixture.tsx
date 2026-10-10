"use client";

// TEST-ONLY wrapper (app/[locale]/e2e-fixtures/cad-cloud): a stored cloud
// result with an inline preview and no-op downloads.

import { CadCloudResult } from "@/components/credits/cad-cloud-result";
import type { CloudManifest } from "@/lib/cad/engine";

const MANIFEST: CloudManifest = {
  engine: "cloud",
  bbox: { x: 80, y: 64, z: 32 },
  volumeMm3: 24500,
  checks: [
    { name: "min_wall", pass: true, detail: "thinnest wall 2.0 mm" },
    { name: "must_contain_box", pass: true, detail: "inside 74 x 58 x 26 mm holds 69 x 53 x 12 mm" },
  ],
  log: "fixture",
  minWallMm: 1.2,
  board: { label: "Arduino Uno", box: { x: 69, y: 53, z: 12 } },
};

const PREVIEW =
  "data:image/svg+xml," +
  encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 64"><rect x="4" y="4" width="72" height="56" rx="4" fill="none" stroke="#0e59c5" stroke-width="2"/></svg>');

export function CadCloudFixture() {
  return <CadCloudResult manifest={MANIFEST} previewUrl={PREVIEW} onDownload={() => undefined} />;
}

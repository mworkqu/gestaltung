"use client";

// The live half of the home hero (W7), loaded only by components/home/hero-enclosure.tsx
// (next/dynamic, ssr:false, after load + interaction + idle + in view). It is the
// Design Studio viewer (components/studio/viewer/Viewer.tsx, same chunk the Studio
// uses) showing the StudioFixture demo product ("Desk buddy": the parts the mock
// Studio API picks, laid out and cased by the Studio's own rules). Slow turntable,
// and every few seconds the case gently opens and closes again.
// `still` (poster capture, /e2e-fixtures/hero-poster): no turn, no loop.

import { useCallback, useEffect, useMemo, useState } from "react";

import Viewer from "@/components/studio/viewer/Viewer";
import { getPart } from "@/lib/studio/library";
import { layoutComponents } from "@/lib/studio/layout";
import { defaultEnclosureFor } from "@/lib/studio/enclosure/templates";
import { clampSpec, type EnclosureSpec } from "@/lib/studio/schema";
import type { EnclosureMeta } from "@/lib/studio/enclosure/plan";
import { STEP_ACCENT } from "@/lib/studio/palette";

/** Same parts as the StudioFixture's mock pick (lib/studio/client/mock.ts PICK). */
export const HERO_DEMO_PARTS = ["esp32_devkit", "pir_hcsr501", "oled_096_i2c", "led_5mm"] as const;

/** Same product the mock spec answers with ("Desk buddy"). */
const DEMO_SPEC = clampSpec({
  name: "Desk buddy",
  oneLine: "A little desk friend that waves when you walk in.",
  use: "desk",
  power: "usb",
  environment: "indoor",
  features: [],
  inputs: [],
  outputs: ["screen", "led"],
  sizeHint: "palm",
  style: "rounded",
  quantity: 1,
});

/** Open → hold → close → hold, in ms. */
const LOOP_MS = 3200;
const OPEN_AT = 0.55;

export function heroDemo() {
  const placed = HERO_DEMO_PARTS.flatMap((partId) => {
    const part = getPart(partId);
    return part ? [{ instanceId: `${partId}_1`, partId, part }] : [];
  });
  const layout = layoutComponents(
    placed.map(({ instanceId, part }) => ({ instanceId, part })),
    { sizeHint: DEMO_SPEC.sizeHint },
  );
  const enclosure: EnclosureSpec = { ...defaultEnclosureFor(DEMO_SPEC), colour: "coral" };
  const components = placed.map(({ instanceId, partId, part }) => ({ instanceId, partId, label: part.name.en }));
  return { components, layout: layout.layout, enclosure };
}

export default function HeroEnclosureLive({ onShown, still = false }: { onShown?: () => void; still?: boolean }) {
  const demo = useMemo(heroDemo, []);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);

  const onMeta = useCallback((meta: EnclosureMeta | null) => {
    if (meta) setReady(true);
  }, []);

  // Two frames after the case is built, the canvas has drawn it: swap the poster out.
  useEffect(() => {
    if (!ready) return;
    let b = 0;
    const a = requestAnimationFrame(() => {
      b = requestAnimationFrame(() => onShown?.());
    });
    return () => {
      cancelAnimationFrame(a);
      cancelAnimationFrame(b);
    };
  }, [ready, onShown]);

  useEffect(() => {
    if (!ready || still) return;
    const id = window.setInterval(() => setOpen((v) => !v), LOOP_MS);
    return () => {
      window.clearInterval(id);
    };
  }, [ready, still]);

  return (
    <div className="h-full w-full" data-hero-ready={ready ? "1" : "0"}>
      <Viewer
        components={demo.components}
        layout={demo.layout}
        enclosure={demo.enclosure}
        explode={open ? OPEN_AT : 0}
        accent={STEP_ACCENT.enclosure.base}
        autoRotate={!still}
        onEnclosureMeta={onMeta}
      />
    </div>
  );
}

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// WEB-01: a stored revision SVG is attacker-writable (project owner can write
// the column directly), so SchematicsStage must show it as an <img> data URI,
// never as inline markup. This renders the real component, so it fails if
// dangerouslySetInnerHTML (or any raw injection) comes back.
// (.test.ts + createElement: the vitest include glob only matches *.test.ts.)

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en",
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));

import { SchematicsStage, type SchematicWithRevs } from "@/components/prototyping/schematics-stage";

const HOSTILE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg"><image href="x" onerror="window.__x=1"/>' +
  '<foreignObject><img src="x" onerror="window.__x=1"></foreignObject></svg>';

const schematic = {
  id: "s1",
  project_id: "p1",
  part_id: null,
  code: "SCH-1",
  title: "Hostile",
  kind: "front",
  revs: [
    {
      id: "r1",
      schematic_id: "s1",
      rev: 1,
      status: "ready",
      prompt: null,
      note: null,
      svg: HOSTILE_SVG,
      error: null,
      confidence: null,
    },
  ],
} as unknown as SchematicWithRevs;

describe("SchematicsStage (WEB-01)", () => {
  const html = renderToStaticMarkup(
    createElement(SchematicsStage, {
      projectId: "p1",
      parts: [],
      schematics: [schematic],
      onChanged: async () => {},
    }),
  );

  it("never emits an event-handler attribute or foreignObject from the stored SVG", () => {
    expect(html).not.toMatch(/onerror\s*=/i);
    expect(html).not.toContain("<foreignObject");
    expect(html).not.toContain("<foreignobject");
    // The payload's own <image>/<img src="x"> must not be live markup either.
    expect(html).not.toContain("<image");
    expect(html.match(/<img\b/g)).toHaveLength(1);
  });

  it("shows the stored SVG only as an <img> with a data:image/svg+xml source", () => {
    expect(html).toMatch(/<img[^>]*\ssrc="data:image\/svg\+xml/);
  });
});

"use server";

import { inGlossaryScope } from "@/lib/cad-champions/admin/override-editor";
import { saveOverrides } from "@/lib/cad-champions/admin/override-editor-server";
import type { ActionResult } from "@/lib/cad-champions/admin/server";

// Glossary editor: term / definition per entry. Term popovers appear on most pages.
export async function saveGlossaryOverridesAction(entries: { key: string; en: string; ar: string }[]): Promise<ActionResult<{ saved: number }>> {
  return saveOverrides(entries, { name: "glossary", allow: inGlossaryScope, paths: ["/", "/get-ready", "/help"] });
}

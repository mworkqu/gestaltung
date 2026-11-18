"use server";

import { inGetReadyScope } from "@/lib/cad-champions/admin/override-editor";
import { saveOverrides } from "@/lib/cad-champions/admin/override-editor-server";
import type { ActionResult } from "@/lib/cad-champions/admin/server";

// Get Ready content editor: texts of the 7 steps + the intro video ids.
export async function saveGetReadyOverridesAction(entries: { key: string; en: string; ar: string }[]): Promise<ActionResult<{ saved: number }>> {
  return saveOverrides(entries, { name: "get-ready", allow: inGetReadyScope, paths: ["/get-ready"] });
}

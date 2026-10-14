"use server";

import { inLandingScope } from "@/lib/cad-champions/admin/override-editor";
import { saveOverrides } from "@/lib/cad-champions/admin/override-editor-server";
import { createTestimonial, deleteTestimonial, moveTestimonialRow, setTestimonialPublished, updateTestimonial } from "@/lib/cad-champions/admin/testimonials-server";
import type { ActionResult } from "@/lib/cad-champions/admin/server";

// Landing editor: FAQ copy + hide flags (cc_content_overrides) and testimonials (cc_testimonials).
export async function saveLandingOverridesAction(entries: { key: string; en: string; ar: string }[]): Promise<ActionResult<{ saved: number }>> {
  return saveOverrides(entries, { name: "landing", allow: inLandingScope, paths: ["/"] });
}

export async function createTestimonialAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  return createTestimonial(input);
}
export async function updateTestimonialAction(id: string, input: unknown): Promise<ActionResult> {
  return updateTestimonial(id, input);
}
export async function setTestimonialPublishedAction(id: string, published: boolean): Promise<ActionResult> {
  return setTestimonialPublished(id, published);
}
export async function deleteTestimonialAction(id: string): Promise<ActionResult> {
  return deleteTestimonial(id);
}
export async function moveTestimonialAction(id: string, dir: "up" | "down"): Promise<ActionResult> {
  return moveTestimonialRow(id, dir);
}

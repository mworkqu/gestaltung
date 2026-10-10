import { MAX_DRAWING_ATTACHMENT_BYTES } from "@/lib/projects/constants";

const IMAGE_EXTS = ["png", "jpg", "jpeg", "webp", "gif", "heic", "heif"];

export function attachmentExt(name: string): string {
  const e = name.includes(".") ? (name.split(".").pop() ?? "") : "";
  return e.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function isPdfPath(path: string): boolean {
  return attachmentExt(path) === "pdf";
}

/** A photo, sketch or PDF up to 20 MB. */
export function checkDrawingAttachment(f: { name: string; type: string; size: number }): "ok" | "type" | "size" {
  const ext = attachmentExt(f.name);
  const okType = f.type.startsWith("image/") || f.type === "application/pdf" || ext === "pdf" || IMAGE_EXTS.includes(ext);
  if (!okType) return "type";
  if (f.size > MAX_DRAWING_ATTACHMENT_BYTES) return "size";
  return "ok";
}

import type { Part } from "@/lib/supabase/types";

// QAR price string, locale-aware: "QAR 12.50" (en) / "12.50 ر.ق" (ar).
export function formatPrice(value: number, locale: string): string {
  const amount = value.toFixed(2);
  return locale === "ar" ? `${amount} ر.ق` : `QAR ${amount}`;
}

// The part name to show for the active locale, falling back to the base name.
export function partName(
  part: Pick<Part, "name" | "name_ar">,
  locale: string
): string {
  if (locale === "ar" && part.name_ar && part.name_ar.trim() !== "") {
    return part.name_ar;
  }
  return part.name;
}

// Return a renderable image URL for a part, or null. Guards against junk values
// that have ended up in the catalog (e.g. the literal text "[link removed]" from
// a sheet's image column) by requiring a real http(s) URL. Google Drive "share"
// links — which don't work as an <img> src — are rewritten to a direct-image URL.
export function partImageUrl(part: Pick<Part, "image_url">): string | null {
  const raw = (part.image_url ?? "").trim();
  if (!raw) return null;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null; // not an absolute URL (covers "[link removed]", bare filenames)
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  // Normalize common Google Drive share formats to a direct-view image URL:
  //   drive.google.com/file/d/<id>/view   ->  drive.google.com/uc?export=view&id=<id>
  //   drive.google.com/open?id=<id>       ->  drive.google.com/uc?export=view&id=<id>
  const host = url.hostname.toLowerCase();
  if (host === "drive.google.com") {
    const m = url.pathname.match(/\/file\/d\/([^/]+)/);
    const id = m?.[1] || url.searchParams.get("id");
    if (id) return `https://drive.google.com/uc?export=view&id=${id}`;
  }

  return url.toString();
}

// The locale-aware description, falling back to the base description.
export function partDescription(
  part: Pick<Part, "description" | "description_ar">,
  locale: string
): string | null {
  if (locale === "ar" && part.description_ar && part.description_ar.trim() !== "") {
    return part.description_ar;
  }
  return part.description ?? null;
}

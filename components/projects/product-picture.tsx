import { cn } from "@/lib/utils";

// The client's chosen Studio design (P5-16): a small square picture, rendered
// from the real model in the Studio and stored in the private project-images
// bucket; `url` is a short-lived signed URL made on the server
// (lib/studio/server/preview-url.ts). No client JS; plain <img> because the
// signed URL changes every request (next/image would re-optimise each time).

export function ProductPicture({ url, alt, size = 96, className }: { url: string; alt: string; size?: number; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- short-lived signed Supabase URL
    <img
      src={url}
      alt={alt}
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      className={cn("shrink-0 rounded-xl border border-borderstrong/40 bg-panel object-contain", className)}
      style={{ width: size, height: size }}
    />
  );
}

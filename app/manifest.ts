import type { MetadataRoute } from "next";

// Web app manifest, served at /manifest.webmanifest. Colours are the design
// tokens from DESIGN.md (canvas #eef2f7, cobalt #0e59c5). The icons are the
// small static SVG and the generated apple icon; no image is stored in /public.
// Not locale-specific on purpose: start_url "/" is sent to the visitor's locale
// by the middleware.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Gestaltung360",
    short_name: "Gestaltung360",
    description: "Shop parts, get a part made, or plan a product. Delivered across Qatar.",
    start_url: "/",
    display: "browser",
    background_color: "#eef2f7",
    theme_color: "#0e59c5",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}

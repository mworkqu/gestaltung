// sharp is installed under the alias "sharp-admin" (package.json:
// "sharp-admin": "npm:sharp@0.35.4") and imported ONLY from here.
//
// Why the alias (2026-10-14, Vercel "Function Storage" 10 GB quota): Next's
// own image optimizer does `require("sharp")` at runtime, so whenever a package
// named "sharp" is installed the file tracer copies it, plus its ~20 MB libvips
// binary, into EVERY route's function bundle (even /favicon.ico). Vercel counts
// that bundle once per route output (500+), i.e. ~5 GB per deployment. With no
// package called "sharp" the optimizer finds nothing (the site never uses
// next/image; Vercel serves images itself), and the aliased package is traced
// only into the six admin routes that import this module (next.config.mjs
// SHARP_ROUTES lists them for the explicit include).
import sharp from "sharp-admin";

export async function loadSharp(): Promise<typeof sharp> {
  return sharp;
}

import { fileURLToPath } from "node:url";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Pin the workspace root to this folder. Without it, Next picks the stray
  // C:\Users\<user>\package-lock.json as root (the folder name has spaces and an
  // em-dash, and there are multiple lockfiles), printing the "inferred workspace
  // root" warning. Vercel builds from a clean checkout and are unaffected.
  outputFileTracingRoot: fileURLToPath(new URL(".", import.meta.url)),

  // Store-first Stage 2: the customer store moved /parts -> /store. Permanent
  // (308) redirects keep old links + bookmarks working, for both locales.
  async redirects() {
    return [
      {
        source: "/:locale(en|ar)/parts",
        destination: "/:locale/store",
        permanent: true,
      },
      {
        source: "/:locale(en|ar)/parts/:path*",
        destination: "/:locale/store/:path*",
        permanent: true,
      },
      // Stage 3: custom-manufacturing consolidated under /design.
      {
        source: "/:locale(en|ar)/cad-assistance",
        destination: "/:locale/design/drawing",
        permanent: true,
      },
      // Order matters: the specific /jobs/new -> /design/upload must precede the
      // general /jobs/:path* rule (first match wins).
      {
        source: "/:locale(en|ar)/dashboard/jobs/new",
        destination: "/:locale/design/upload",
        permanent: true,
      },
      {
        source: "/:locale(en|ar)/dashboard/jobs",
        destination: "/:locale/design/jobs",
        permanent: true,
      },
      {
        source: "/:locale(en|ar)/dashboard/jobs/:path*",
        destination: "/:locale/design/jobs/:path*",
        permanent: true,
      },
      // Stage 4: inventory is its own top-level signed-in area now.
      {
        source: "/:locale(en|ar)/dashboard/inventory",
        destination: "/:locale/inventory",
        permanent: true,
      },
      {
        source: "/:locale(en|ar)/dashboard/inventory/:path*",
        destination: "/:locale/inventory/:path*",
        permanent: true,
      },
    ];
  },
};

export default withNextIntl(nextConfig);

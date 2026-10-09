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

  // Phase G caching: /<locale>/store without query params is a static (ISR)
  // page. With any listing param (lib/store/catalog.ts STORE_URL_PARAMS —
  // keep the two lists in step; catalog.test.ts checks) the request is
  // rewritten to the dynamic /store/search route, which renders the same
  // listing. The browser URL stays /store?..., the query is passed through.
  // beforeFiles runs after the middleware and before the page lookup.
  async rewrites() {
    return {
      beforeFiles: ["q", "category", "material", "stock", "sort", "page"].map((key) => ({
        source: "/:locale(en|ar)/store",
        has: [{ type: "query", key }],
        destination: "/:locale/store/search",
      })),
    };
  },

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
      // The jobs pipeline was retired. Every legacy job URL — and the old
      // authenticated /design/upload route — now lands on the public quote
      // flow, which is the surviving way to send us a CAD file.
      {
        source: "/:locale(en|ar)/design/upload/:path*",
        destination: "/:locale/design/quote",
        permanent: true,
      },
      {
        source: "/:locale(en|ar)/design/upload",
        destination: "/:locale/design/quote",
        permanent: true,
      },
      {
        source: "/:locale(en|ar)/design/jobs/:path*",
        destination: "/:locale/design/quote",
        permanent: true,
      },
      {
        source: "/:locale(en|ar)/design/jobs",
        destination: "/:locale/design/quote",
        permanent: true,
      },
      {
        source: "/:locale(en|ar)/dashboard/jobs/:path*",
        destination: "/:locale/design/quote",
        permanent: true,
      },
      {
        source: "/:locale(en|ar)/dashboard/jobs",
        destination: "/:locale/design/quote",
        permanent: true,
      },
      // P1-06: "Get credits" became the #credits section of /pricing. Next drops a
      // hash in a redirect destination, so the links we control carry
      // "/pricing#credits" themselves.
      {
        source: "/:locale(en|ar)/credits",
        destination: "/:locale/pricing",
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
      // Stage 5: admin parts store renamed dashboard/parts -> dashboard/store.
      {
        source: "/:locale(en|ar)/dashboard/parts",
        destination: "/:locale/dashboard/store",
        permanent: true,
      },
      {
        source: "/:locale(en|ar)/dashboard/parts/:path*",
        destination: "/:locale/dashboard/store/:path*",
        permanent: true,
      },
    ];
  },
};

export default withNextIntl(nextConfig);

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
};

export default withNextIntl(nextConfig);

// Build label for the compact dashboard footer (D7): the short git commit on
// Vercel (VERCEL_GIT_COMMIT_SHA), else the package version. Server-side only.

export function buildLabel(sha: string | undefined | null, pkgVersion: string): string {
  const s = (sha ?? "").trim();
  return /^[0-9a-f]{7,40}$/i.test(s) ? s.slice(0, 7) : `v${pkgVersion}`;
}

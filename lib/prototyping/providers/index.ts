// Picks the analysis provider named by ANALYSIS_PROVIDER. Server-only.
//
// Providers are loaded by file name, so adding one is a new file in this
// folder and nothing else. The name is checked against a strict pattern before
// it reaches the import, so an env typo cannot load an arbitrary module.

import type { AnalysisProvider } from "./types";

export const DEFAULT_PROVIDER = "gemini";

export function configuredProviderName(): string {
  return (process.env.ANALYSIS_PROVIDER ?? DEFAULT_PROVIDER).trim().toLowerCase();
}

export async function loadProvider(name: string): Promise<AnalysisProvider | null> {
  if (!/^[a-z][a-z0-9-]{0,30}$/.test(name) || name === "types" || name === "index") return null;
  try {
    const mod = (await import(`./${name}`)) as { default?: AnalysisProvider };
    return mod.default ?? null;
  } catch {
    return null;
  }
}

/** What the page tells the client about where the brief goes. */
export async function providerStatus(): Promise<{ name: string; destination: string | null }> {
  const p = await loadProvider(configuredProviderName());
  if (p && p.configured()) return { name: p.name, destination: p.destination };
  // Not usable, so every analysis will run on the basic reader.
  return { name: "rules", destination: null };
}

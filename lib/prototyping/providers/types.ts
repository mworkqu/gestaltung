// The analysis provider adapter. Server-only.
//
// A provider is one file in this folder whose default export satisfies
// AnalysisProvider. ANALYSIS_PROVIDER=<file name> selects it; nothing else in
// the app changes to add one (see ./index.ts).

import type { AnalysisRequest, FallbackReason } from "../analysis";

export type TokenUsage = { input: number; output: number; total: number };

export type ProviderResult = {
  /** The provider's answer, UNVALIDATED. The route runs it through zod. */
  raw: unknown;
  usage?: TokenUsage;
  model?: string;
  latencyMs?: number;
  /** The provider's reply exactly as received, for the diagnostic record. */
  rawText?: string;
};

export interface AnalysisProvider {
  /** Matches the file name and ANALYSIS_PROVIDER. */
  name: string;
  /** Who receives the brief text, shown to the client. null = stays on our server. */
  destination: string | null;
  /** False when a required secret is missing; the route then falls back. */
  configured(): boolean;
  analyse(req: AnalysisRequest): Promise<ProviderResult>;
}

/** A failure that sends the route to the basic reader, with the reason shown. */
export class ProviderError extends Error {
  constructor(public reason: FallbackReason, detail?: string) {
    super(detail ?? reason);
  }
}

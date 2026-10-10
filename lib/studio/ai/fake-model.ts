// Test helper: a StudioCall that runs the REAL validatedCall (retry with the
// problems fed back, metering, analysis_runs) against a scripted fake model and
// a no-op Supabase client. Used by lib/studio/ai/*.test.ts only.

import type { SupabaseClient } from "@supabase/supabase-js";

import { validatedCall, type ModelCaller } from "@/lib/prototyping/ai-call";
import type { StudioCall } from "./types";

export type FakeModel = {
  call: StudioCall;
  /** Every prompt the model received, in order. */
  prompts: string[];
  /** Every temperature the model was called with. */
  temperatures: (number | undefined)[];
};

export function fakeModel(answers: unknown[]): FakeModel {
  const prompts: string[] = [];
  const temperatures: (number | undefined)[] = [];
  const queue = [...answers];
  const caller: ModelCaller = async (opts) => {
    prompts.push(opts.prompt);
    temperatures.push(opts.temperature);
    const next = queue.shift();
    if (next instanceof Error) throw next;
    return { raw: next, rawText: JSON.stringify(next ?? null), model: "fake-model", latencyMs: 1 };
  };
  const supabase = {
    rpc: async () => ({ data: null, error: null }),
    from: () => ({ insert: async () => ({ error: null }) }),
  } as unknown as SupabaseClient;
  const call: StudioCall = (req) =>
    validatedCall({
      supabase,
      projectId: "00000000-0000-4000-8000-000000000000",
      feature: "studio",
      step: req.step,
      system: req.system,
      prompt: req.prompt,
      schema: req.schema,
      validate: req.validate,
      temperature: 0.2,
      caller,
    });
  return { call, prompts, temperatures };
}

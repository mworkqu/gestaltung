// The context object every Studio step receives from StudioShell. Lives in its
// own type-only module so the steps do not import the shell that imports them
// (import cycle). StudioShell re-exports it for older import paths.

import type { Locale, StudioApi } from "@/lib/studio/client/api";
import type { FlowStep } from "@/lib/studio/client/steps";

export type StudioCtx = {
  api: StudioApi;
  locale: Locale;
  projectId: string;
  projectName: string;
  /** Step number (1-based) and accent come from the step id. */
  n: (step: FlowStep) => number;
  /** super_admin (checked on the server): the Engineer view of the product designs. */
  isAdmin?: boolean;
};

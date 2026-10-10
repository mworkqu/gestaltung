"use client";

// TEST-ONLY (app/[locale]/e2e-fixtures/studio): the Design Studio on a mock
// StudioApi — no Supabase, no AI, no credit, nothing written.

import { useMemo } from "react";

import { mockStudioApi } from "@/lib/studio/client/mock";
import { StudioShell } from "./StudioShell";

export function StudioFixture() {
  const api = useMemo(() => mockStudioApi(), []);
  return <StudioShell projectId={api.projectId} destination="Google Gemini" api={api} />;
}

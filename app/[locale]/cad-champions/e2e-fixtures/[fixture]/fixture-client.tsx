"use client";

import * as React from "react";

import { UploadTransportContext, type UploadTransport } from "@/components/cad-champions/upload/upload-box";

// TEST-ONLY (see page.tsx): every UploadBox below "stores" its file in memory
// instead of Supabase Storage. Progress jumps 0 -> 100 and the promise
// resolves at once, so the e2e specs see the real "Uploaded" state and the
// component's onUploaded follow-up (a server action the spec mocks).

const instantUpload: UploadTransport = async ({ onProgress }) => {
  onProgress(50);
  await new Promise((resolve) => window.setTimeout(resolve, 50));
  onProgress(100);
};

export function FixtureUploads({ children }: { children: React.ReactNode }) {
  return <UploadTransportContext.Provider value={instantUpload}>{children}</UploadTransportContext.Provider>;
}

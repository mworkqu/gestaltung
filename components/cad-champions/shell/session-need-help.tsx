"use client";

import { NeedHelpButton } from "@/components/cad-champions/ui";

import { useCcSession } from "./session-context";

// The floating "Need help?" button, shown once the browser session says the
// visitor is signed in (display only; the page itself enforces access).
export function CcSessionNeedHelp(props: { pageName: string; whatsappNumber: string | null; supportEmail: string }) {
  const { session } = useCcSession();
  if (!session) return null;
  return <NeedHelpButton {...props} />;
}

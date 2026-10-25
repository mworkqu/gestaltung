// The production wiring of createLead's dependencies. Server-only: it reaches
// the cookie-bound and service-role Supabase clients and the e-mail sender.

import { OWNER_EMAIL, sendEmail } from "@/lib/email";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { buildQuoteCalc, isMissingQuoteColumn } from "@/lib/studio/server/quote";

import type { LeadDeps } from "./save";

/** `origin` is this deployment's origin (links in the message and the e-mail footer). */
export function leadDeps(origin: string): LeadDeps {
  return {
    userClient: () => createClient(),
    serviceClient: () => createServiceClient(),
    canSave: !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    sendEmail,
    ownerEmail: OWNER_EMAIL,
    buildQuoteCalc,
    isMissingQuoteColumn,
    origin,
  };
}

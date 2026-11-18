import { getCcContact } from "@/lib/cad-champions/site-contact";

import { CcSessionNeedHelp } from "./session-need-help";

// Extras shown only to SIGNED-IN visitors (dashboard, get ready, test, results,
// training, help, policies, admin): the floating "Need help?" button. The
// session is checked in the browser (session-context.tsx), not here, so a page
// that only uses this stays prerenderable. Pages that need auth call
// requireCcUser themselves.
export async function SignedInExtras({ pageName }: { pageName: string }) {
  const { whatsappNumber, supportEmail } = await getCcContact();
  return <CcSessionNeedHelp pageName={pageName} whatsappNumber={whatsappNumber} supportEmail={supportEmail} />;
}

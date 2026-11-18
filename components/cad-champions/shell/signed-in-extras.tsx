import { NeedHelpButton } from "@/components/cad-champions/ui";
import { getCcUser } from "@/lib/cad-champions/auth/server";
import { getCcContact } from "@/lib/cad-champions/site-contact";

// Extras shown only on SIGNED-IN CC pages (dashboard, get ready, test, results,
// training, help, admin): the floating "Need help?" button. Renders nothing
// without a CC session (getCcUser is memoised per request, so this is free
// next to the page's own requireCcUser call).
export async function SignedInExtras({ pageName }: { pageName: string }) {
  if (!(await getCcUser())) return null;
  const { whatsappNumber, supportEmail } = await getCcContact();
  return <NeedHelpButton pageName={pageName} whatsappNumber={whatsappNumber} supportEmail={supportEmail} />;
}

import { NeedHelpButton } from "@/components/cad-champions/ui";
import { getCcContact } from "@/lib/cad-champions/site-contact";

// Extras shown only on SIGNED-IN CC pages (dashboard, get ready, test, results,
// training, help, admin): the floating "Need help?" button.
// TODO(Prompt 2): render nothing without a CC session (cc_profiles); there is no
// CC auth yet, so the placeholder pages show it unconditionally.
export function SignedInExtras({ pageName }: { pageName: string }) {
  const { whatsappNumber, supportEmail } = getCcContact();
  return <NeedHelpButton pageName={pageName} whatsappNumber={whatsappNumber} supportEmail={supportEmail} />;
}

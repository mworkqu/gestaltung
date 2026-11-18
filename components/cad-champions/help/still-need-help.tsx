import { getTranslations } from "next-intl/server";

import type { Locale } from "@/i18n/routing";
import { getCcContact } from "@/lib/cad-champions/site-contact";

import { StillNeedHelpView } from "./still-need-help-view";

/** "Still need help?" block: WhatsApp (when configured) + email. Server component. */
export async function StillNeedHelp({
  locale,
  topic,
  title,
  body,
}: {
  locale: Locale;
  topic: string;
  title?: string;
  body?: string;
}) {
  const t = await getTranslations({ locale, namespace: "CC.help" });
  const { whatsappNumber, supportEmail } = await getCcContact();
  return (
    <StillNeedHelpView
      t={(k, v) => t(k as never, v as never)}
      topic={topic}
      whatsappNumber={whatsappNumber}
      supportEmail={supportEmail}
      title={title}
      body={body}
    />
  );
}

import { setRequestLocale } from "next-intl/server";

import { MessagesScope } from "@/components/i18n/messages-scope";
import { JoinForm } from "@/components/schools/join-form";
import { metaFor } from "@/lib/meta";
import { turnstileEnabledForPages } from "@/lib/turnstile-server";

export const generateMetadata = metaFor("join");

// A class team joins with the code on the teacher's sheet (3c). Static: the
// ?code= prefill is read in the browser by the form, never via searchParams.
export default async function JoinPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const turnstileEnabled = await turnstileEnabledForPages();

  return (
    <MessagesScope scope="join">
      <div className="container page-stack">
        <JoinForm turnstileEnabled={turnstileEnabled} />
      </div>
    </MessagesScope>
  );
}

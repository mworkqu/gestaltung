import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Inbox, Mail, MessageCircle } from "lucide-react";

import type { Inquiry } from "@/lib/supabase/types";
import { getSessionContext } from "@/lib/auth/get-session";
import { createClient } from "@/lib/supabase/server";
import { toWhatsAppDigits } from "@/lib/phone";
import { cn } from "@/lib/utils";

// Every enquiry the site captures — homepage callbacks and CAD quote requests
// both land in `inquiries` via /api/store-lead and /api/design-quote. Read-only
// triage view: the owner replies over WhatsApp, which is why the number gets a
// direct wa.me link rather than plain text to copy.
export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, string> = {
  new: "border-azure/40 bg-azure/10 text-azure",
  contacted: "border-borderstrong bg-panel text-body",
  closed: "border-borderstrong/60 bg-transparent text-faint",
};

export default async function LeadsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  // RLS already restricts these rows to super_admin, but redirect rather than
  // render an empty table at a signed-in workshop or client.
  const session = await getSessionContext();
  if (!session) redirect(`/${locale}/sign-in`);
  if (session.profile.role !== "super_admin") redirect(`/${locale}/dashboard`);

  const t = await getTranslations("Leads");
  const isRtl = locale === "ar";
  const mono = (extra = "") =>
    cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);

  const supabase = await createClient();
  const { data } = await supabase
    .from("inquiries")
    .select("*")
    .order("created_at", { ascending: false });
  const leads = (data ?? []) as Inquiry[];

  const dateFmt = new Intl.DateTimeFormat(isRtl ? "ar-QA" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <div>
      <div>
        <p className={mono("text-[10px] text-azure")}>{t("kicker")}</p>
        <h1 className="mt-2 text-2xl font-extrabold text-heading">{t("title")}</h1>
        <p className="mt-1 text-sm text-mutedtext">
          {t("count", { count: leads.length })}
        </p>
      </div>

      {leads.length === 0 ? (
        <div className="neu mt-8 flex flex-col items-center gap-3 p-12 text-center">
          <Inbox className="h-8 w-8 text-faint" aria-hidden />
          <p className="text-base font-semibold text-heading">{t("emptyTitle")}</p>
          <p className="max-w-sm text-sm text-mutedtext">{t("emptyBody")}</p>
        </div>
      ) : (
        <ul className="mt-8 space-y-4">
          {leads.map((lead) => {
            // null when the stored number can't form a valid wa.me link.
            const waDigits = toWhatsAppDigits(lead.phone);

            return (
              <li key={lead.id} className="neu p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-base font-semibold text-heading">
                      {lead.name}
                    </p>
                    <p className={mono("mt-1 text-[10px] text-faint")}>
                      {t("colDate")} · {dateFmt.format(new Date(lead.created_at))}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 rounded-full border px-3 py-1 text-[11px] font-medium",
                      STATUS_TONE[lead.status] ?? STATUS_TONE.contacted
                    )}
                  >
                    {t(`status_${lead.status}`)}
                  </span>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {waDigits ? (
                    <a
                      href={`https://wa.me/${waDigits}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 rounded-full border border-azure/40 bg-azure/10 px-4 py-2 text-sm font-medium text-azure transition hover:bg-azure/20"
                    >
                      <MessageCircle className="h-4 w-4" aria-hidden />
                      <span dir="ltr">{lead.phone}</span>
                    </a>
                  ) : (
                    <span
                      className="inline-flex items-center gap-2 rounded-full border border-borderstrong/60 px-4 py-2 text-sm text-faint"
                      title={t("whatsappUnavailable")}
                    >
                      <MessageCircle className="h-4 w-4" aria-hidden />
                      <span dir="ltr">{lead.phone}</span>
                    </span>
                  )}

                  {lead.email ? (
                    <a
                      href={`mailto:${lead.email}`}
                      className="inline-flex items-center gap-2 rounded-full border border-borderstrong px-4 py-2 text-sm text-body transition hover:border-azure/40 hover:text-azure"
                    >
                      <Mail className="h-4 w-4" aria-hidden />
                      <span dir="ltr">{lead.email}</span>
                    </a>
                  ) : (
                    <span className="text-sm text-faint">{t("noEmail")}</span>
                  )}

                  <span className={mono("text-[10px] text-faint")}>
                    {lead.locale}
                  </span>
                </div>

                <div className="mt-4 border-t border-borderstrong/60 pt-4">
                  <p className={mono("text-[10px] text-faint")}>{t("colMessage")}</p>
                  {/* Quote enquiries arrive as multi-line text (method, file, notes). */}
                  <p className="mt-2 whitespace-pre-line text-sm text-body">
                    {lead.message}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

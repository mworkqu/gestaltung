import { notFound, redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowLeft, Mail, MessageCircle } from "lucide-react";

import { QuoteCalcCard } from "@/components/admin/quote-calc-card";
import { QuoteForm } from "@/components/admin/quote-form";
import { Link } from "@/i18n/navigation";
import { leadKind } from "@/lib/admin/lead-kind";
import { parseLeadMessage } from "@/lib/admin/lead-parse";
import { getSessionContext } from "@/lib/auth/get-session";
import { formatPhoneDisplay, toWhatsAppDigits } from "@/lib/phone";
import { parseQuoteCalc } from "@/lib/studio/request-summary";
import { createClient } from "@/lib/supabase/server";
import type { Inquiry } from "@/lib/supabase/types";

import { saveLeadQuote } from "../actions";

// W2b (2026-10-11): one enquiry in full. For a Studio "Get it made" request:
// "How we calculated" (the snapshot stored with the lead) and "Your quote
// (QAR)" + note → saved on the lead, shown to the client on their request
// page. super_admin only (redirect here, RLS on the row). Before 0073 runs the
// lead still shows, with "Run migration 0073 first".

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function LeadDetailPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  if (!UUID.test(id)) notFound();

  const session = await getSessionContext();
  if (!session) redirect(`/${locale}/sign-in`);
  if (session.profile.role !== "super_admin") redirect(`/${locale}/dashboard`);

  const supabase = await createClient();
  const { data } = await supabase.from("inquiries").select("*").eq("id", id).maybeSingle();
  const lead = data as Inquiry | null;
  if (!lead) notFound();

  const t = await getTranslations("Leads");
  const tq = await getTranslations("LeadQuote");
  const migrated = "quote_calc" in lead;
  const calc = parseQuoteCalc(lead.quote_calc);
  const parsed = parseLeadMessage(lead.message);
  const wa = toWhatsAppDigits(lead.phone);
  const final = lead.final_quote_qar === null || lead.final_quote_qar === undefined ? null : Number(lead.final_quote_qar);
  const dateFmt = new Intl.DateTimeFormat(locale === "ar" ? "ar-QA-u-nu-latn" : "en-GB", { dateStyle: "medium", timeStyle: "short" });

  return (
    <div className="space-y-6" data-testid="lead-detail">
      <Link href="/dashboard/leads" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-cobalt hover:text-cobalt-hover">
        <ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden />
        {tq("backToLeads")}
      </Link>

      <section className="neu space-y-3 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="title-page break-words">{lead.name}</h1>
            <p className="mt-1 text-xs text-faint">
              {t(`kind_${leadKind(lead.message)}`)} · {t("colDate")} {dateFmt.format(new Date(lead.created_at))} · {t(`status_${lead.status}`)}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {wa ? (
            <a
              href={`https://wa.me/${wa}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center gap-2 rounded-full border border-azure/40 bg-azure/10 px-4 text-sm font-medium text-azure hover:bg-azure/20"
            >
              <MessageCircle className="h-4 w-4" aria-hidden />
              <span dir="ltr">{formatPhoneDisplay(lead.phone)}</span>
            </a>
          ) : (
            <span className="inline-flex min-h-11 items-center px-2 text-sm text-faint" dir="ltr">
              {formatPhoneDisplay(lead.phone)}
            </span>
          )}
          {lead.email && (
            <a
              href={`mailto:${lead.email}`}
              className="inline-flex min-h-11 items-center gap-2 rounded-full border border-borderstrong px-4 text-sm text-body hover:border-azure/40 hover:text-azure"
            >
              <Mail className="h-4 w-4" aria-hidden />
              <span dir="ltr">{lead.email}</span>
            </a>
          )}
        </div>
        {(parsed.body || parsed.notes) && (
          <p className="whitespace-pre-line break-words text-sm text-body">
            {[parsed.body, parsed.notes ? `${t("labelNotes")}: ${parsed.notes}` : null].filter(Boolean).join("\n\n")}
          </p>
        )}
      </section>

      {!migrated ? (
        <p className="neu p-5 text-sm font-semibold text-heading" data-testid="lead-run-migration">
          {tq("runMigration")}
        </p>
      ) : calc ? (
        <>
          <QuoteCalcCard calc={calc} locale={locale} />
          {final !== null && lead.quoted_at && (
            <p className="text-sm text-mutedtext">{tq("quotedOn", { date: dateFmt.format(new Date(lead.quoted_at)), amount: String(final) })}</p>
          )}
          <QuoteForm leadId={lead.id} locale={locale} midpoint={calc.midpoint} initialFinal={final} initialNote={lead.quote_note ?? null} action={saveLeadQuote} />
        </>
      ) : (
        <p className="neu p-5 text-sm text-mutedtext">{tq("noCalc")}</p>
      )}
    </div>
  );
}

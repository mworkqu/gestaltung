import { getTranslations } from "next-intl/server";

import { applyCreditAction } from "@/app/[locale]/dashboard/meetings/actions";
import { formatQar } from "@/lib/format/money";
import type { Locale } from "@/lib/locale";
import { creditableMeetingFor, loadMeetingSettings } from "@/lib/meetings/server";
import { slotLabel } from "@/lib/meetings/slots";

/**
 * "Meeting credit available: QAR 150" on an admin order page (0113).
 *
 * The customer paid for a meeting within the credit window and has not used it
 * yet. Applying it only RECORDS the credit against this order and tells the
 * owner what to take off when he confirms the price on WhatsApp — no order
 * total and no checkout maths change (create_part_order is untouched).
 *
 * Renders nothing when there is no such meeting, or before migration 0113.
 */
export async function MeetingCredit({
  order,
  locale,
}: {
  order: { id: string; customer_phone: string | null; customer_email: string | null; created_at: string };
  locale: Locale;
}) {
  const settings = await loadMeetingSettings();
  const meeting = await creditableMeetingFor({ phone: order.customer_phone, email: order.customer_email }, order.created_at, settings);
  if (!meeting) return null;

  const t = await getTranslations({ locale, namespace: "DashboardMeetings" });
  const amount = formatQar(Number(meeting.invoice_qar) || settings.price_qar, locale);

  return (
    <div className="border-t border-borderstrong/40 pt-4" data-testid="order-meeting-credit">
      <p className="mb-2 text-sm font-semibold text-heading">{t("creditAvailable", { amount })}</p>
      <p className="mb-3 text-xs text-mutedtext">{slotLabel(meeting.starts_at, locale, settings)}</p>
      <form action={applyCreditAction}>
        <input type="hidden" name="id" value={meeting.id} />
        <input type="hidden" name="orderId" value={order.id} />
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="tab" value="past" />
        <button
          type="submit"
          className="inline-flex min-h-11 items-center justify-center rounded-full bg-cobalt px-4 text-sm font-semibold text-white transition-colors hover:bg-cobalt-hover active:scale-[0.98]"
          data-testid="order-meeting-credit-apply"
        >
          {t("creditApply")}
        </button>
      </form>
    </div>
  );
}

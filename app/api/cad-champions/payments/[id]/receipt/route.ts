import { getTranslations } from "next-intl/server";

import { getCcUser } from "@/lib/cad-champions/auth/server";
import { formatDate, formatQAR } from "@/lib/cad-champions/format";
import { htmlToPdf } from "@/lib/cad-champions/html-pdf";
import { formatReceiptNumber, getReceiptLetterhead, renderReceiptHtml, type ReceiptStrings } from "@/lib/cad-champions/payments/receipts";
import { loadPayment } from "@/lib/cad-champions/payments/server";

// GET /api/cad-champions/payments/<id>/receipt
// Owner (or staff) only, paid/refunded payments only. Bilingual receipt as a
// PDF with headless Chromium when installed (local), else the same page as
// printable HTML (Vercel), like the certificate and the results report.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" };

const KEYS = ["title", "number", "date", "billedTo", "plan", "cohort", "listPrice", "discount", "addon", "total", "method", "reference", "cr", "paidNote", "print", "htmlNote"] as const;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cc = await getCcUser();
  if (!cc) return Response.json({ error: "signed_out" }, { status: 401, headers: NO_STORE });
  const loaded = await loadPayment(cc.user.id, id, cc.isStaff);
  if (!loaded.ok) return Response.json({ error: loaded.reason }, { status: 503, headers: NO_STORE });
  const p = loaded.value;
  if (!p || (p.status !== "paid" && p.status !== "refunded") || !p.receipt_number) {
    return Response.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
  }

  try {
    const [tEn, tAr] = await Promise.all([
      getTranslations({ locale: "en", namespace: "CC.payments.receipt" }),
      getTranslations({ locale: "ar", namespace: "CC.payments.receipt" }),
    ]);
    const [mEn, mAr] = await Promise.all([
      getTranslations({ locale: "en", namespace: "CC.payments.method" }),
      getTranslations({ locale: "ar", namespace: "CC.payments.method" }),
    ]);
    const strings = Object.fromEntries(KEYS.map((k) => [k, [tEn(k), tAr(k)]])) as unknown as ReceiptStrings;
    const date = p.paid_at ?? p.created_at;
    const own = p.user_id === cc.user.id;
    const html = (fallbackNote: boolean) =>
      renderReceiptHtml(
        {
          number: formatReceiptNumber(p.receipt_number),
          date: [formatDate(date, "en"), formatDate(date, "ar")],
          studentName: (own ? cc.profile?.full_name : null) || p.payer_name || "-",
          studentEmail: own ? (cc.profile?.email ?? cc.user.email ?? null) : null,
          plan: [p.plan?.name_en ?? "CAD Champions", p.plan?.name_ar ?? p.plan?.name_en ?? "CAD Champions"],
          cohort: p.cohort ? [p.cohort.name_en, p.cohort.name_ar] : null,
          listPrice: p.discount_qar > 0 && p.list_price_qar != null ? formatQAR(p.list_price_qar, "en") : null,
          discount: p.discount_qar > 0 ? formatQAR(p.discount_qar, "en") : null,
          addon: p.addon && p.addon_qar > 0 ? [p.addon.name_en, p.addon.name_ar, formatQAR(p.addon_qar, "en")] : null,
          total: formatQAR(p.amount_qar, "en"),
          method: [mEn(p.method), mAr(p.method)],
          referenceCode: p.reference_code,
        },
        strings,
        getReceiptLetterhead(),
        { fallbackNote },
      );
    const base = `cad-champions-receipt-${formatReceiptNumber(p.receipt_number)}`;
    const pdf = await htmlToPdf(html(false));
    if (pdf) {
      return new Response(Buffer.from(pdf), {
        headers: { ...NO_STORE, "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${base}.pdf"` },
      });
    }
    return new Response(html(true), {
      headers: { ...NO_STORE, "Content-Type": "text/html; charset=utf-8", "Content-Disposition": `inline; filename="${base}.html"`, "X-Robots-Tag": "noindex" },
    });
  } catch (e) {
    console.error("[cc-receipt] render failed:", e instanceof Error ? e.message : "unknown");
    return Response.json({ error: "error" }, { status: 500, headers: NO_STORE });
  }
}

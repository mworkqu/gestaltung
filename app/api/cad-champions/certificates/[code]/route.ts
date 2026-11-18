import { getTranslations } from "next-intl/server";

import type { Locale } from "@/i18n/routing";
import { getCcUser } from "@/lib/cad-champions/auth/server";
import { formatDate } from "@/lib/cad-champions/format";
import { htmlToPdf } from "@/lib/cad-champions/html-pdf";
import { buildCertificateHtml, type CertificateStrings } from "@/lib/cad-champions/training/certificate";
import { certificateData, loadOwnCertificate } from "@/lib/cad-champions/training/certificate-server";

// GET /api/cad-champions/certificates/<code>?lang=en|ar
// Session-checked (owner or staff, via RLS). A4 landscape certificate as PDF
// with headless Chromium when it is installed (local), else the same page as
// printable HTML (Vercel), like the results report.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "private, no-store, max-age=0" };

export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const lang: Locale = new URL(req.url).searchParams.get("lang") === "ar" ? "ar" : "en";
  const cc = await getCcUser();
  if (!cc) return Response.json({ error: "signed_out" }, { status: 401, headers: NO_STORE });
  const cert = await loadOwnCertificate(code, lang);
  if (!cert) return Response.json({ error: "not_found" }, { status: 404, headers: NO_STORE });

  try {
    const t = await getTranslations({ locale: lang, namespace: "CC.training.certificate" });
    const strings: CertificateStrings = {
      heading: t("heading"),
      awardedTo: t("awardedTo"),
      forCompleting: t("forCompleting"),
      issued: t("issued"),
      code: t("code"),
      verifyAt: t("verifyAt"),
      disclaimer: t("disclaimer"),
      brand: t("brand"),
      print: t("print"),
      htmlNote: t("htmlNote"),
    };
    const data = certificateData(cert, lang, formatDate(cert.issuedAt, lang), t("noName"));
    const base = `cad-champions-certificate-${cert.code}-${lang}`;
    const pdf = await htmlToPdf(buildCertificateHtml(data, strings), { landscape: true });
    if (pdf) {
      return new Response(Buffer.from(pdf), {
        headers: { ...NO_STORE, "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${base}.pdf"` },
      });
    }
    return new Response(buildCertificateHtml(data, strings, { fallbackNote: true }), {
      headers: { ...NO_STORE, "Content-Type": "text/html; charset=utf-8", "Content-Disposition": `inline; filename="${base}.html"`, "X-Robots-Tag": "noindex" },
    });
  } catch (e) {
    console.error("[cc-cert] render failed:", e instanceof Error ? e.message : "unknown");
    return Response.json({ error: "error" }, { status: 500, headers: NO_STORE });
  }
}

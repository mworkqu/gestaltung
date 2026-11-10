// Certificate lookups — SERVER ONLY.

import type { Locale } from "@/i18n/routing";
import { SITE_URL } from "@/lib/seo";
import { createClient } from "@/lib/supabase/server";

import { ccPath } from "../routes";
import { normaliseCertificateCode, type CertificateData, type CertificateStrings } from "./certificate";
import { pick } from "./server";

if (typeof window !== "undefined") throw new Error("lib/cad-champions/training/certificate-server.ts is server-only");

export interface OwnCertificate {
  code: string;
  userId: string;
  issuedAt: string;
  moduleTitle: string;
  studentName: string | null;
}

/** A certificate the signed-in user may see (RLS: own, or staff). */
export async function loadOwnCertificate(codeInput: string, locale: Locale): Promise<OwnCertificate | null> {
  const code = normaliseCertificateCode(codeInput);
  if (!code) return null;
  try {
    const db = await createClient();
    const { data } = await db
      .from("cc_certificates")
      .select("code,user_id,issued_at,cc_modules(title_en,title_ar),cc_profiles(full_name,full_name_ar)")
      .eq("code", code)
      .maybeSingle<{
        code: string;
        user_id: string;
        issued_at: string;
        cc_modules: { title_en: string; title_ar: string } | { title_en: string; title_ar: string }[] | null;
        cc_profiles: { full_name: string | null; full_name_ar: string | null } | { full_name: string | null; full_name_ar: string | null }[] | null;
      }>();
    if (!data) return null;
    const mod = Array.isArray(data.cc_modules) ? data.cc_modules[0] : data.cc_modules;
    const prof = Array.isArray(data.cc_profiles) ? data.cc_profiles[0] : data.cc_profiles;
    return {
      code: data.code,
      userId: data.user_id,
      issuedAt: data.issued_at,
      moduleTitle: mod ? pick(locale, mod.title_en, mod.title_ar) : "",
      studentName: pick(locale, prof?.full_name ?? null, prof?.full_name_ar ?? null) || null,
    };
  } catch (e) {
    console.error("[cc-cert] load failed:", e instanceof Error ? e.message : "unknown");
    return null;
  }
}

export function verifyUrl(locale: Locale, code: string): string {
  return `${SITE_URL}${ccPath(locale, `/verify/${code}`)}`;
}

export function certificateData(cert: OwnCertificate, locale: Locale, dateText: string, fallbackName: string): CertificateData {
  return { lang: locale, studentName: cert.studentName ?? fallbackName, moduleTitle: cert.moduleTitle, dateText, code: cert.code, verifyUrl: verifyUrl(locale, cert.code) };
}

export type { CertificateStrings };

export interface VerifiedCertificate {
  code: string;
  name: string | null;
  moduleTitle: string;
  issuedAt: string;
}

/** Public check via cc_verify_certificate (anon ok). null = not found; "unavailable" on error. */
export async function verifyCertificate(codeInput: string, locale: Locale): Promise<VerifiedCertificate | null | "unavailable"> {
  const code = normaliseCertificateCode(codeInput);
  if (!code) return null;
  try {
    const db = await createClient();
    const { data, error } = await db.rpc("cc_verify_certificate", { p_code: code });
    if (error) {
      console.error("[cc-cert] verify failed:", error.code ?? error.message);
      return "unavailable";
    }
    if (!data || typeof data !== "object") return null;
    const d = data as { code: string; full_name: string | null; full_name_ar: string | null; module_title_en: string; module_title_ar: string; issued_at: string };
    return { code: d.code, name: pick(locale, d.full_name, d.full_name_ar) || null, moduleTitle: pick(locale, d.module_title_en, d.module_title_ar), issuedAt: d.issued_at };
  } catch {
    return "unavailable";
  }
}

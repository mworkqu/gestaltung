// Bilingual receipt (Prompt 10 Step G): Gestaltung360 letterhead, CR number
// and address (env CC_RECEIPT_* [TODO-MO], falling back to lib/company.ts),
// the receipt number from cc_receipt_number_seq, student, plan, amount in QAR,
// method, date. renderReceiptHtml is PURE (tested); the route turns it into a
// PDF with lib/cad-champions/html-pdf.ts (local) or serves printable HTML.

import { COMPANY, COMPANY_ADDRESS } from "@/lib/company";

type Env = Record<string, string | undefined>;

export interface ReceiptLetterhead {
  brand: string;
  legalNameEn: string;
  legalNameAr: string;
  crNumber: string;
  addressEn: string;
  addressAr: string;
}

export function getReceiptLetterhead(env: Env = process.env): ReceiptLetterhead {
  const pick = (v: string | undefined, fallback: string) => ((v ?? "").trim() ? (v ?? "").trim() : fallback);
  return {
    brand: "Gestaltung360",
    legalNameEn: COMPANY.legalNameEn,
    legalNameAr: COMPANY.legalNameAr,
    crNumber: pick(env.CC_RECEIPT_CR_NUMBER, COMPANY.crNumber),
    addressEn: pick(env.CC_RECEIPT_ADDRESS_EN, COMPANY_ADDRESS.en),
    addressAr: pick(env.CC_RECEIPT_ADDRESS_AR, COMPANY_ADDRESS.ar),
  };
}

export function formatReceiptNumber(n: number | string | null | undefined): string {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? `CC-${String(Math.floor(v)).padStart(6, "0")}` : "";
}

/** Label pairs: [English, Arabic]. Filled from payments.json receipt.* in both locales. */
export interface ReceiptStrings {
  title: [string, string];
  number: [string, string];
  date: [string, string];
  billedTo: [string, string];
  plan: [string, string];
  cohort: [string, string];
  listPrice: [string, string];
  discount: [string, string];
  addon: [string, string];
  total: [string, string];
  method: [string, string];
  reference: [string, string];
  cr: [string, string];
  paidNote: [string, string];
  print: [string, string];
  htmlNote: [string, string];
}

export interface ReceiptData {
  number: string;
  /** Pre-formatted per language. */
  date: [string, string];
  studentName: string;
  studentEmail: string | null;
  plan: [string, string];
  cohort: [string, string] | null;
  listPrice: string | null;
  discount: string | null;
  addon: [string, string, string] | null; // [name en, name ar, amount]
  total: string;
  method: [string, string];
  referenceCode: string;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function row(label: [string, string], valueHtml: string): string {
  return `<tr><th scope="row"><span class="en">${esc(label[0])}</span><span class="ar" dir="rtl" lang="ar">${esc(label[1])}</span></th><td>${valueHtml}</td></tr>`;
}

const ltr = (s: string) => `<bdi dir="ltr">${esc(s)}</bdi>`;
const both = (v: [string, string]) => `<span class="en">${esc(v[0])}</span><span class="ar" dir="rtl" lang="ar">${esc(v[1])}</span>`;

export function renderReceiptHtml(d: ReceiptData, s: ReceiptStrings, lh: ReceiptLetterhead, opts: { fallbackNote?: boolean } = {}): string {
  const rows = [
    row(s.number, ltr(d.number)),
    row(s.date, both(d.date)),
    row(s.billedTo, `${esc(d.studentName)}${d.studentEmail ? `<br>${ltr(d.studentEmail)}` : ""}`),
    row(s.plan, both(d.plan)),
    d.cohort ? row(s.cohort, both(d.cohort)) : "",
    d.listPrice ? row(s.listPrice, ltr(d.listPrice)) : "",
    d.discount ? row(s.discount, ltr(`- ${d.discount}`)) : "",
    d.addon ? row(s.addon, `${both([d.addon[0], d.addon[1]])} ${ltr(d.addon[2])}`) : "",
    row(s.method, both(d.method)),
    row(s.reference, ltr(d.referenceCode)),
  ].join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(s.title[0])} ${esc(d.number)}</title>
<style>
@page { size: A4; margin: 16mm; }
* { box-sizing: border-box; }
body { margin: 0; font-family: Arial, Helvetica, "Segoe UI", Tahoma, sans-serif; color: #1c2434; background: #eef2f7; }
.sheet { max-width: 760px; margin: 24px auto; background: #fff; border: 1px solid #d3dbe6; border-radius: 16px; padding: 32px; }
.head { display: flex; justify-content: space-between; gap: 16px; border-bottom: 3px solid #0e59c5; padding-bottom: 16px; }
.brand { font-size: 26px; font-weight: 800; color: #0e59c5; }
.small { font-size: 12px; color: #475569; line-height: 1.6; }
.ar { display: block; font-family: "Segoe UI", Tahoma, Arial, sans-serif; text-align: right; }
.en { display: block; }
h1 { font-size: 22px; margin: 24px 0 8px; display: flex; justify-content: space-between; }
table { width: 100%; border-collapse: collapse; margin-top: 8px; }
th, td { border-bottom: 1px solid #e6ebf2; padding: 10px 8px; text-align: left; vertical-align: top; font-size: 14px; }
th { width: 38%; color: #475569; font-weight: 600; }
.total { margin-top: 16px; display: flex; justify-content: space-between; align-items: center; background: #e6ebf2; border-radius: 12px; padding: 14px 16px; font-size: 18px; font-weight: 800; }
.note { margin-top: 16px; font-size: 12px; color: #64748b; }
.print { margin: 16px auto; display: block; padding: 10px 20px; border-radius: 999px; border: 0; background: #0e59c5; color: #fff; font-weight: 700; cursor: pointer; }
.fallback { max-width: 760px; margin: 16px auto 0; font-size: 13px; color: #475569; text-align: center; }
@media print { body { background: #fff; } .sheet { border: 0; margin: 0; } .print, .fallback { display: none; } }
</style></head>
<body>
${opts.fallbackNote ? `<p class="fallback">${esc(s.htmlNote[0])} · <span dir="rtl" lang="ar">${esc(s.htmlNote[1])}</span></p><button class="print" onclick="window.print()">${esc(s.print[0])} · ${esc(s.print[1])}</button>` : ""}
<main class="sheet">
  <div class="head">
    <div>
      <div class="brand">${esc(lh.brand)}</div>
      <div class="small">${esc(lh.legalNameEn)}<br>${esc(lh.addressEn)}<br>${esc(s.cr[0])} ${ltr(lh.crNumber)}</div>
    </div>
    <div class="small ar" dir="rtl" lang="ar">${esc(lh.legalNameAr)}<br>${esc(lh.addressAr)}<br>${esc(s.cr[1])} ${ltr(lh.crNumber)}</div>
  </div>
  <h1><span>${esc(s.title[0])}</span><span dir="rtl" lang="ar">${esc(s.title[1])}</span></h1>
  <table>${rows}</table>
  <div class="total"><span>${esc(s.total[0])} · <span dir="rtl" lang="ar">${esc(s.total[1])}</span></span>${ltr(d.total)}</div>
  <p class="note">${esc(s.paidNote[0])}<br><span dir="rtl" lang="ar">${esc(s.paidNote[1])}</span></p>
</main>
</body></html>`;
}

// Module completion certificates (Prompt 9 Step E). PURE, tested.
// The code is public (printed on the certificate, checked at /verify/[code]),
// so it is random and long enough not to be guessed: "CC-" + 8 characters
// from an alphabet without look-alikes (no 0/O, 1/I/L).
//
// buildCertificateHtml() returns a self-contained A4 landscape page (inline
// CSS, IBM Plex Sans Arabic from Google Fonts, dir="rtl" for Arabic). The
// certificate route prints it to PDF with headless Chromium when available
// (local), else serves it as printable HTML (Vercel), like the results report.

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** "CC-XXXX-XXXX". `random` returns bytes (crypto.getRandomValues / randomBytes). */
export function generateCertificateCode(random: (n: number) => Uint8Array): string {
  const bytes = random(8);
  let s = "";
  for (let i = 0; i < 8; i++) s += ALPHABET[bytes[i] % ALPHABET.length];
  return `CC-${s.slice(0, 4)}-${s.slice(4)}`;
}

const CODE_RE = /^CC-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

/** Normalises user input ("cc-abcd-2345 ") to the stored form, or null. */
export function normaliseCertificateCode(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const s = input.trim().toUpperCase();
  return CODE_RE.test(s) ? s : null;
}

export interface CertificateStrings {
  heading: string;
  awardedTo: string;
  forCompleting: string;
  issued: string;
  code: string;
  verifyAt: string;
  disclaimer: string;
  brand: string;
  print: string;
  htmlNote?: string;
}

export interface CertificateData {
  lang: "en" | "ar";
  studentName: string;
  moduleTitle: string;
  dateText: string;
  code: string;
  verifyUrl: string;
}

function e(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function buildCertificateHtml(d: CertificateData, s: CertificateStrings, opts: { fallbackNote?: boolean } = {}): string {
  const ar = d.lang === "ar";
  const font = "'IBM Plex Sans Arabic', 'Segoe UI', Tahoma, Arial, sans-serif";
  const note =
    opts.fallbackNote && s.htmlNote
      ? `<div class="note no-print">${e(s.htmlNote)} <button type="button" onclick="window.print()">${e(s.print)}</button></div>`
      : "";
  return `<!doctype html>
<html lang="${d.lang}" dir="${ar ? "rtl" : "ltr"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${e(s.heading)} · ${e(d.code)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;700&display=swap" rel="stylesheet">
<style>
  @page { size: A4 landscape; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: ${font}; color: #0f1b2d; background: #eef2f7; }
  .sheet { width: 297mm; min-height: 210mm; margin: 0 auto; padding: 18mm; background: #ffffff; position: relative; }
  .frame { border: 3px solid #1d4ed8; border-radius: 10px; height: calc(210mm - 36mm); padding: 14mm 18mm; display: flex; flex-direction: column; justify-content: space-between; text-align: center; }
  .brand { font-size: 14px; letter-spacing: ${ar ? "0" : "0.18em"}; text-transform: ${ar ? "none" : "uppercase"}; color: #1d4ed8; font-weight: 700; }
  h1 { font-size: 40px; margin: 10px 0 0; }
  .to { margin-top: 18px; font-size: 16px; color: #475569; }
  .name { font-size: 34px; font-weight: 700; margin: 6px 0 0; }
  .for { margin-top: 16px; font-size: 16px; color: #475569; }
  .module { font-size: 24px; font-weight: 700; margin-top: 6px; }
  .meta { display: flex; justify-content: space-between; gap: 16px; font-size: 13px; color: #334155; text-align: start; }
  .meta b { display: block; color: #0f1b2d; font-size: 15px; }
  .ltr { direction: ltr; unicode-bidi: isolate; }
  .disclaimer { font-size: 11px; color: #64748b; margin-top: 10px; }
  .note { max-width: 297mm; margin: 0 auto; padding: 10px 18mm; font-size: 13px; background: #fff8e1; }
  .note button { margin-inline-start: 8px; padding: 6px 12px; border-radius: 8px; border: 1px solid #1d4ed8; background: #1d4ed8; color: #fff; cursor: pointer; }
  @media print { body { background: #fff; } .no-print { display: none; } }
</style>
</head>
<body>
${note}
<main class="sheet">
  <div class="frame">
    <div>
      <div class="brand">${e(s.brand)}</div>
      <h1>${e(s.heading)}</h1>
      <div class="to">${e(s.awardedTo)}</div>
      <div class="name">${e(d.studentName)}</div>
      <div class="for">${e(s.forCompleting)}</div>
      <div class="module">${e(d.moduleTitle)}</div>
    </div>
    <div>
      <div class="meta">
        <div>${e(s.issued)}<b>${e(d.dateText)}</b></div>
        <div>${e(s.code)}<b class="ltr">${e(d.code)}</b></div>
        <div>${e(s.verifyAt)}<b class="ltr">${e(d.verifyUrl)}</b></div>
      </div>
      <div class="disclaimer">${e(s.disclaimer)}</div>
    </div>
  </div>
</main>
</body>
</html>`;
}

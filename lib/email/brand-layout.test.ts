import { describe, expect, it } from "vitest";

import { renderBrandedEmail } from "./brand-layout";
import { renderLeadEmail } from "./lead-email";
import { parseLeadMessage } from "@/lib/admin/lead-parse";

const UUID = "c3881430-94d3-4c79-9b61-7507a012d582";
const SIGNED = "https://x.supabase.co/storage/v1/object/sign/quote-uploads/abc/part.stl?token=eyJhbGciOi";

/** The text a reader sees: tags and hrefs removed. */
const visible = (html: string) => html.replace(/<title>[\s\S]*?<\/title>/, "").replace(/<[^>]+>/g, " ");

describe("renderBrandedEmail", () => {
  it("renders RTL for Arabic and LTR for English", () => {
    const ar = renderBrandedEmail({ locale: "ar", title: "مرحبا", paragraphs: ["نص"] });
    const en = renderBrandedEmail({ locale: "en", title: "Hello", paragraphs: ["Text"] });
    expect(ar.html).toContain('<html lang="ar" dir="rtl">');
    expect(ar.html).toContain('dir="rtl"');
    expect(ar.html).toContain("text-align:right");
    expect(en.html).toContain('dir="ltr"');
    expect(en.html).not.toContain('dir="rtl"');
  });

  it("has the logo, cobalt accent, buttons and a plain-text twin", () => {
    const out = renderBrandedEmail({
      locale: "en",
      title: "T",
      buttons: [{ label: "Open it", url: "https://gestaltung360.com/en/x?a=1&b=2" }],
    });
    expect(out.html).toContain('src="https://gestaltung360.com/icon.png"');
    expect(out.html).toContain("#0e59c5");
    expect(out.html).toContain('href="https://gestaltung360.com/en/x?a=1&amp;b=2"');
    expect(out.html).not.toContain("<style");
    expect(out.html).not.toContain("<link");
    expect(out.text).toContain("Open it: https://gestaltung360.com/en/x?a=1&b=2");
  });

  it("escapes everything it is given", () => {
    const out = renderBrandedEmail({ locale: "en", title: "<script>x</script>", paragraphs: ['"><img onerror=1>'] });
    expect(out.html).not.toContain("<script>x");
    expect(out.html).not.toContain("<img onerror");
  });
});

describe("renderLeadEmail", () => {
  const mail = renderLeadEmail({
    title: "New quote request",
    name: "Mona",
    phone: "+97466567410",
    email: "mona@example.com",
    method: "CNC machining",
    file: { name: "bracket.stl", sizeBytes: 2048 },
    downloadUrl: SIGNED,
    projectName: "Plant monitor",
    language: "ar",
    siteUrl: "https://gestaltung360.com",
  });

  it("shows the formatted phone, a wa.me button and the real size", () => {
    expect(visible(mail.html)).toContain("+974 6656 7410");
    expect(mail.html).toContain('href="https://wa.me/97466567410"');
    expect(visible(mail.html)).toContain("bracket.stl (2 KB)");
    expect(mail.html).not.toContain("0.00 MB");
  });

  it("has the two buttons and no raw URL or id in visible text", () => {
    expect(mail.html).toContain(">Download file<");
    expect(mail.html).toContain(">Open in dashboard<");
    expect(mail.html).toContain(`href="${SIGNED.replace(/&/g, "&amp;")}"`);
    const v = visible(mail.html);
    expect(v).not.toMatch(/https?:\/\//);
    expect(v).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
    expect(v).not.toContain("token=");
    expect(v).not.toContain("+97466567410");
  });

  it("is English whatever the customer's language", () => {
    expect(mail.html).toContain('lang="en"');
    expect(visible(mail.html)).toContain("Arabic");
  });
});

describe("parseLeadMessage", () => {
  it("reads a quote message, hides the link and id, keeps the notes", () => {
    const p = parseLeadMessage(
      `Custom manufacturing quote request.\nMethod: Laser cutting\nFile: a.dxf (1.5 MB)\nStorage: quote-uploads/u/a.dxf\nDownload (valid 7 days): ${SIGNED}\nProject: Box — https://gestaltung360.com/en/projects/${UUID}\nEmail: a@b.c\nPhone / WhatsApp: +97466567410\n\nNotes:\n3 mm acrylic, 10 pcs`
    );
    expect(p).toMatchObject({ method: "Laser cutting", fileName: "a.dxf", fileSize: "1.5 MB", projectId: UUID, projectName: "Box" });
    expect(p.storage).toEqual({ bucket: "quote-uploads", path: "u/a.dxf" });
    expect(p.downloadUrl).toBe(SIGNED);
    expect(p.notes).toBe("3 mm acrylic, 10 pcs");
    expect(p.body).toBe("");
  });

  it("treats the old '0.00 MB' as no size and finds an id-only project", () => {
    const p = parseLeadMessage(`Custom manufacturing quote request.\nFile: a.stl (0.00 MB)\nProject: ${UUID} (export: https://x/api/admin/projects/${UUID}/export)`);
    expect(p.fileSize).toBeNull();
    expect(p.projectId).toBe(UUID);
    expect(p.projectName).toBeNull();
    expect(p.body).toBe("");
  });

  it("cleans a drawing request and leaves free text alone", () => {
    const d = parseLeadMessage(`Drawing request for project "Box" (${UUID}).\n\nA bracket for a motor.`);
    expect(d.projectName).toBe("Box");
    expect(d.body).toBe("A bracket for a motor.");
    expect(parseLeadMessage("Hello, see https://example.com").body).toBe("Hello, see https://example.com");
  });
});

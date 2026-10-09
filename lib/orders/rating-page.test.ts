import { describe, expect, it } from "vitest";

import { commentFormHtml, renderRatingPage } from "./rating-page";

describe("commentFormHtml", () => {
  it("posts to the review route with the hidden fields and a 280-character box", () => {
    const html = commentFormHtml("en", { order: "o-1", score: 4, token: "tok" });
    expect(html).toContain('method="post"');
    expect(html).toContain('action="/api/orders/review"');
    expect(html).toContain('name="order" value="o-1"');
    expect(html).toContain('name="score" value="4"');
    expect(html).toContain('name="l" value="en"');
    expect(html).toContain('name="t" value="tok"');
    expect(html).toContain('maxlength="280"');
    expect(html).toContain("Add a one-line comment (optional)");
    expect(html).toContain("We read every comment before it appears on the website.");
  });

  it("leaves the score out when there is none and escapes the typed text", () => {
    const html = commentFormHtml("ar", { order: "o", score: null, token: "t", comment: '"><script>x</script>' });
    expect(html).not.toContain('name="score"');
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("نقرأ كل تعليق");
  });
});

describe("renderRatingPage", () => {
  it("sends no-store, noindex and no referrer, with the visitor language first", async () => {
    const res = renderRatingPage({
      locale: "ar",
      title: { en: "Thank you", ar: "شكرًا لك" },
      status: 200,
      section: (l, primary) => `<p>${l}${primary ? "-primary" : ""}</p>`,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex");
    const html = await res.text();
    expect(html.indexOf("ar-primary")).toBeLessThan(html.indexOf("<p>en</p>"));
    expect(html).toContain('<html lang="ar" dir="rtl">');
  });
});

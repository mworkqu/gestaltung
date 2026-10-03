import { describe, expect, it } from "vitest";

import { projectLinkEmail } from "@/lib/projects/link-email";
import { isUuid, projectLinkUrl, recoveryKeyFromHash } from "@/lib/projects/recovery";

const ID = "11111111-2222-4333-8444-555555555555";
const KEY = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

describe("projectLinkUrl / recoveryKeyFromHash", () => {
  it("puts the key in the fragment, not the query", () => {
    const url = projectLinkUrl("https://gestaltung360.com/", "ar", ID, KEY);
    expect(url).toBe(`https://gestaltung360.com/ar/projects/${ID}#key=${KEY}`);
    expect(new URL(url).search).toBe("");
  });

  it("reads the key back from location.hash", () => {
    expect(recoveryKeyFromHash(`#key=${KEY}`)).toBe(KEY);
    expect(recoveryKeyFromHash(`#key=${KEY.toUpperCase()}`)).toBe(KEY);
    expect(recoveryKeyFromHash("")).toBeNull();
    expect(recoveryKeyFromHash(null)).toBeNull();
    expect(recoveryKeyFromHash("#key=not-a-uuid")).toBeNull();
    expect(recoveryKeyFromHash("#section")).toBeNull();
  });

  it("isUuid", () => {
    expect(isUuid(ID)).toBe(true);
    expect(isUuid("x")).toBe(false);
    expect(isUuid(undefined)).toBe(false);
  });
});

describe("projectLinkEmail", () => {
  const url = projectLinkUrl("https://gestaltung360.com", "en", ID, KEY);

  it("English: subject, link, keep line, brand, ltr", () => {
    const m = projectLinkEmail({ locale: "en", projectName: "Plant <monitor>", url, kind: "created" });
    expect(m.subject).toBe("Your Gestaltung360 project link");
    expect(m.html).toContain(`href="${url}"`);
    expect(m.html).toContain('dir="ltr"');
    expect(m.html).not.toContain('dir="rtl"');
    expect(m.html).toContain("Plant &lt;monitor&gt;");
    expect(m.html).toContain("Keep this email to open your project on any device.");
    expect(m.html).toContain("Gestaltung for Trading and Services W.L.L · C.R. 236988");
    expect(m.html).toContain("+974 6656 7410");
    expect(m.text).toContain(url);
    expect(m.html).not.toContain("Earlier links no longer work");
  });

  it("Arabic: subject, link, rtl", () => {
    const arUrl = projectLinkUrl("https://gestaltung360.com", "ar", ID, KEY);
    const m = projectLinkEmail({ locale: "ar", projectName: "جهاز", url: arUrl, kind: "created" });
    expect(m.subject).toBe("رابط مشروعك في Gestaltung360");
    expect(m.html).toContain('dir="rtl"');
    expect(m.html).toContain(`href="${arUrl}"`);
    expect(m.html).toContain("احتفظ بهذه الرسالة لفتح مشروعك على أي جهاز.");
    expect(m.text).toContain(arUrl);
  });

  it("moved: explains the new link", () => {
    const m = projectLinkEmail({ locale: "en", projectName: "X", url, kind: "moved" });
    expect(m.html).toContain("Earlier links no longer work");
    expect(m.text).toContain("Earlier links no longer work");
  });
});

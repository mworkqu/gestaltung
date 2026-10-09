import { expect, expectLocale, LOCALES, test } from "./fixtures";

// /institutions/proposal is a one-page A4 pilot proposal (P2-05). In print
// media the sheet shows and the page must fit ONE A4 page, in EN and AR.
// page.pdf() is Chromium-headless only, so the page count runs on the desktop
// project; the mobile project still checks the print layout renders.
for (const locale of LOCALES) {
  test(`proposal prints as one A4 page [${locale}]`, async ({ page }, testInfo) => {
    await page.goto(`/${locale}/institutions/proposal`);
    await expectLocale(page, locale);

    await page.emulateMedia({ media: "print" });
    const sheet = page.locator("[data-print-sheet]");
    await expect(sheet).toBeVisible();
    // Site chrome is gone on paper: no footer.
    await expect(page.locator("footer")).toBeHidden();

    if (testInfo.project.name !== "desktop") return;

    const pdf = await page.pdf({ format: "A4", preferCSSPageSize: true, printBackground: true });
    // Count page objects: "/Type /Page" not followed by "s" ("/Type /Pages" is the tree).
    const pages = (pdf.toString("latin1").match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
    expect(pages, "proposal PDF page count").toBe(1);
  });
}

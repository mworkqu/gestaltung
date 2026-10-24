import { expect, expectLocale, expectNoHorizontalOverflow, LOCALES, msg, test } from "./fixtures";

// The password-reset flow after the 2026-10 change (docs/AUTH_EMAILS.md).
//
// The point of the rebuild is that opening the emailed link does NOTHING: mail
// security (Microsoft 365 Safe Links, Mimecast, Proofpoint) pre-fetches every
// link in an incoming message, and the old Supabase verify URL was single-use,
// so the token was already spent when the person clicked. These tests assert
// the page renders the form and makes no auth call at all before submit.
//
// Read-only: no form is submitted against Supabase. The resend countdown needs
// the "sent" screen, so that ONE request (POST /auth/v1/recover) is fulfilled
// locally by a page route — it never leaves the browser and never reaches the
// production project. The write guard in fixtures.ts is untouched.

const TOKEN_HASH = "a".repeat(56);
/** Phone and laptop; the second value is the owner's own screen width. */
const WIDTHS = [375, 1366] as const;

/** Anything that would spend a token or sign someone in. */
const AUTH_CALL = /\/auth\/v1\/(verify|otp|recover|token|signup)/;

for (const locale of LOCALES) {
  test(`the reset link renders the form and verifies nothing on GET [${locale}]`, async ({ page }) => {
    const authCalls: string[] = [];
    page.on("request", (r) => {
      if (AUTH_CALL.test(new URL(r.url()).pathname)) authCalls.push(`${r.method()} ${new URL(r.url()).pathname}`);
    });

    await page.goto(`/${locale}/reset-password?token_hash=${TOKEN_HASH}&type=recovery`);
    await expectLocale(page, locale);

    // The password form, with the hash kept out of sight until submit.
    await expect(page.getByRole("heading", { name: msg(locale, "Auth", "resetHeading") })).toBeVisible();
    await expect(page.locator("#password")).toBeVisible();
    await expect(page.locator("#confirm")).toBeVisible();
    await expect(page.getByRole("button", { name: msg(locale, "Auth", "resetSubmit") })).toBeEnabled();
    // The code route's fields are not on this screen.
    await expect(page.locator("#code")).toHaveCount(0);

    // THE WHOLE POINT: a scanner's pre-fetch spends nothing.
    await page.waitForLoadState("networkidle");
    expect(authCalls, "an auth call was made before the form was submitted").toEqual([]);

    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await expectNoHorizontalOverflow(page);
    }
  });

  test(`no token hash: the 6-digit code route [${locale}]`, async ({ page }) => {
    const authCalls: string[] = [];
    page.on("request", (r) => {
      if (AUTH_CALL.test(new URL(r.url()).pathname)) authCalls.push(r.url());
    });

    await page.goto(`/${locale}/reset-password`);
    await expectLocale(page, locale);

    await expect(page.getByRole("heading", { name: msg(locale, "Auth", "resetCodeHeading") })).toBeVisible();
    await expect(page.locator("#email")).toBeVisible();
    // Western digits in both languages, so the code field reads left to right.
    await expect(page.locator("#code")).toHaveAttribute("dir", "ltr");
    await expect(page.locator("#password")).toBeVisible();

    // Client-side checks answer without a round trip, and still no auth call.
    await page.locator("#email").fill("someone@example.com");
    await page.locator("#code").fill("123456");
    await page.locator("#password").fill("abcdef");
    await page.locator("#confirm").fill("abcdefg");
    // Retry the press until React is attached (before that the form would not
    // be intercepted at all).
    await expect(async () => {
      await page.getByRole("button", { name: msg(locale, "Auth", "resetSubmit") }).click();
      await expect(page.getByRole("alert")).toHaveText(msg(locale, "Auth", "passwordMismatch"), { timeout: 1000 });
    }).toPass({ timeout: 15_000 });
    expect(authCalls).toEqual([]);

    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await expectNoHorizontalOverflow(page);
    }
  });

  test(`an expired link sends them back to ask for a new one [${locale}]`, async ({ page }) => {
    await page.goto(`/${locale}/forgot-password?expired=1`);
    await expectLocale(page, locale);

    await expect(page.getByRole("alert")).toHaveText(msg(locale, "Auth", "linkUsedOrExpired"));
    await expect(page.locator("#email")).toBeVisible();
    // The way out when the link keeps failing: the code from the same email.
    await expect(page.getByRole("link", { name: msg(locale, "Auth", "haveCode") })).toHaveAttribute(
      "href",
      `/${locale}/reset-password`,
    );

    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await expectNoHorizontalOverflow(page);
    }
  });

  test(`the sent screen: spam hint, 3 hours, resend countdown [${locale}]`, async ({ page }) => {
    // Page routes run before the context guard, so this request is answered
    // here and never sent anywhere. Nothing is written to production.
    await page.route("**/auth/v1/recover**", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
    );

    await page.goto(`/${locale}/forgot-password`);
    const email = page.locator("#email");
    await expect(async () => {
      await email.fill("someone@example.com");
      await expect(email).toHaveValue("someone@example.com", { timeout: 1000 });
    }).toPass({ timeout: 15_000 });

    const heading = page.getByRole("heading", { name: msg(locale, "Auth", "forgotSentHeading") });
    await expect(async () => {
      await page.getByRole("button", { name: msg(locale, "Auth", "forgotSubmit") }).click();
      await expect(heading).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 20_000 });

    // "Check your email", the address, the spam line and the 3-hour validity.
    const sent = msg(locale, "Auth", "forgotSent").replace("{email}", "someone@example.com");
    await expect(page.getByText(sent)).toBeVisible();
    await expect(page.getByText(msg(locale, "Auth", "forgotValidFor").replace("{hours}", "3"))).toBeVisible();

    // Resend is dead for 60 seconds and says how long is left, in Western digits.
    const resend = page.getByTestId("resend");
    await expect(resend).toBeDisabled();
    const pattern = msg(locale, "Auth", "forgotResendIn").split("{seconds}");
    await expect(resend).toContainText(pattern[0]!.trim());
    await expect(resend).toContainText(/[0-9]{1,2}/);

    await expect(page.getByRole("link", { name: msg(locale, "Auth", "haveCode") })).toBeVisible();

    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await expectNoHorizontalOverflow(page);
    }
  });

  test(`confirm-email asks for one press and verifies nothing on GET [${locale}]`, async ({ page }) => {
    const authCalls: string[] = [];
    page.on("request", (r) => {
      if (AUTH_CALL.test(new URL(r.url()).pathname)) authCalls.push(r.url());
    });

    await page.goto(`/${locale}/confirm-email?token_hash=${TOKEN_HASH}&type=signup`);
    await expectLocale(page, locale);

    await expect(page.getByRole("heading", { name: msg(locale, "Auth", "confirmHeading") })).toBeVisible();
    await expect(page.getByRole("button", { name: msg(locale, "Auth", "confirmSubmit") })).toBeEnabled();
    await page.waitForLoadState("networkidle");
    expect(authCalls, "confirm-email verified on load").toEqual([]);

    // A link the mail client cut short: no button, just the way back.
    await page.goto(`/${locale}/confirm-email`);
    await expect(page.getByText(msg(locale, "Auth", "confirmMissing"))).toBeVisible();
    await expect(page.getByRole("button", { name: msg(locale, "Auth", "confirmSubmit") })).toHaveCount(0);

    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await expectNoHorizontalOverflow(page);
    }
  });
}

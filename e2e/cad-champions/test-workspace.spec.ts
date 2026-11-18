import { FX, PACKAGE_EXPECTATIONS } from "../../app/[locale]/cad-champions/e2e-fixtures/[fixture]/fixture-data";
import { checkPackage, parseExpectations, PACKAGE_MAX_ENTRIES, templateEntries } from "../../lib/cad-champions/upload/package-check";
import { readZipEntries } from "../../lib/cad-champions/upload/zip-manifest";
import { zipStore, type ZipEntry } from "../../lib/studio/zip";

import { cc, expect, layoutOk, LOCALES, openFixture, STEP_TEXT, test } from "./cc";

// Test intro gate, live workspace (per_task upload, module_package ZIP with a
// VALID and an INVALID Results folder, timer warnings) and the submitted
// screen. Uploads are in memory (fixture provider); every server action is
// answered by the mock in cc.ts, so nothing reaches Supabase or a real action.

const ROOT = "A01/DAY 01/Results";

function zip(entries: ZipEntry[]): Buffer {
  return Buffer.from(zipStore(entries, new Date("2026-10-14T08:00:00Z")));
}

/** The template layout plus both expected parts as STEP files. */
function validZip(): Buffer {
  return zip([
    ...templateEntries("A01", "DAY 01").map((name) => ({ name, data: "" })),
    { name: `${ROOT}/Parts and Assemblies/Part_01.step`, data: STEP_TEXT },
    { name: `${ROOT}/Parts and Assemblies/Part_02.stp`, data: STEP_TEXT },
    { name: `${ROOT}/PDF files/Part_01.pdf`, data: "%PDF-1.4\n%%EOF\n" },
  ]);
}

/** Wrong layout: part 1 only as a native Inventor file, part 2 missing, a file outside Results. */
function invalidZip(): Buffer {
  return zip([
    { name: "A01/", data: "" },
    { name: "A01/Parts and Assemblies/", data: "" },
    { name: "A01/Parts and Assemblies/Part_01.ipt", data: "native" },
    { name: "A01/notes.txt", data: "loose file" },
  ]);
}

/** What validatePackageAction returns: the real ZIP listing + checkPackage, run here in Node. */
async function manifestFor(bytes: Buffer) {
  const listing = await readZipEntries(bytes.length, async (start, end) => new Uint8Array(bytes.subarray(start, end + 1)), {
    maxEntries: PACKAGE_MAX_ENTRIES,
  });
  if (!listing.ok) throw new Error(`fixture ZIP not readable: ${listing.reason}`);
  return checkPackage(listing.entries, parseExpectations(PACKAGE_EXPECTATIONS));
}

const isRecord = (args: unknown[] | null): args is [Record<string, unknown>] => !!args && typeof args[0] === "object" && args[0] !== null;

for (const locale of LOCALES) {
  test.describe(`test flow (${locale})`, () => {
    test("intro gate: locked, cooldown, continue and ready -> start", async ({ page, actions }) => {
      await openFixture(page, locale, "test-intro", "?gate=locked");
      await expect(page.getByRole("region", { name: cc(locale, "test", "intro.lockedLabel") })).toBeVisible();
      await expect(page.getByRole("link", { name: cc(locale, "test", "intro.lockedLink") })).toBeVisible();
      await expect(page.getByRole("button", { name: cc(locale, "test", "intro.start") })).toBeDisabled();
      await layoutOk(page);

      await openFixture(page, locale, "test-intro", "?gate=cooldown");
      await expect(page.getByRole("region", { name: cc(locale, "test", "intro.cooldownLabel") })).toBeVisible();

      await openFixture(page, locale, "test-intro", "?gate=continue");
      await expect(page.getByRole("heading", { name: cc(locale, "test", "intro.continueTitle") })).toBeVisible();

      await openFixture(page, locale, "test-intro", "?gate=ready");
      const start = page.getByRole("button", { name: cc(locale, "test", "intro.start") });
      await expect(start).toBeDisabled();
      await page.getByLabel(cc(locale, "test", "intro.agreeRules")).check();
      await page.getByLabel(cc(locale, "test", "intro.agreeHonour")).check();
      await expect(start).toBeEnabled();
      actions.on((args) => (args?.[0] === FX.slug ? { ok: true } : undefined));
      await start.click();
      const dialog = page.getByRole("dialog", { name: cc(locale, "test", "intro.startDialogTitle") });
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: cc(locale, "test", "intro.startConfirm") }).click();
      // The real attempt page needs a session, so the app lands on it or on sign-in.
      await page.waitForURL(/\/test\/e2e-sample-test\/attempt|\/sign-in/);
      expect(actions.calls.map((c) => c.args)).toEqual([[FX.slug]]);
    });

    test("per_task workspace: upload a STEP file for task 1", async ({ page, actions }) => {
      actions.on((args) => (isRecord(args) && args[0].taskId === FX.task1 ? { ok: true, uploadedAt: new Date().toISOString(), replacedCount: 0 } : undefined));
      await openFixture(page, locale, "workspace", "?mode=per_task");
      const tab1 = page.locator(`#cc-task-tab-${FX.task1}`);
      await expect(tab1).toContainText(cc(locale, "test", "workspace.chip.not_started"));
      await layoutOk(page);

      await page.locator(`#cc-task-panel-${FX.task1} input[type="file"]`).setInputFiles({
        name: "Bracket.step",
        mimeType: "application/step",
        buffer: Buffer.from(STEP_TEXT),
      });
      await expect(tab1).toContainText(cc(locale, "test", "workspace.chip.uploaded"));
      await expect(page.locator(`#cc-task-panel-${FX.task1}`)).toContainText("Bracket.step");
      expect(actions.calls).toHaveLength(1);
      const saved = actions.calls[0].args?.[0] as Record<string, unknown>;
      expect(saved).toMatchObject({ attemptId: FX.attemptId, taskId: FX.task1, fileName: "Bracket.step" });
      expect(String(saved.path)).toContain(`${FX.userId}/${FX.attemptId}/${FX.task1}/`);
      await layoutOk(page);
    });

    test("module_package: a VALID Results ZIP shows every expected file found", async ({ page, actions }) => {
      const bytes = validZip();
      const manifest = await manifestFor(bytes);
      expect(manifest.ok && manifest.warnings.length === 0, JSON.stringify(manifest.warnings)).toBe(true);
      actions.on((args) => {
        if (isRecord(args) && args[0].taskId === null) return { ok: true, uploadedAt: new Date().toISOString(), replacedCount: 0 };
        if (args?.length === 1 && args[0] === FX.attemptId) return { ok: true, manifest };
        return undefined;
      });
      await openFixture(page, locale, "workspace", "?mode=module_package");
      await page.locator('input[type="file"][accept=".zip"]').setInputFiles({ name: "A01-results.zip", mimeType: "application/zip", buffer: bytes });

      await expect(page.getByText(cc(locale, "test", "package.allGood"))).toBeVisible();
      const pkg = page.locator("section", { has: page.locator("#cc-package-title") });
      await expect(pkg.locator("li li").getByText(cc(locale, "test", "package.item.found"), { exact: true })).toHaveCount(2);
      await expect(page.locator(`#cc-task-tab-${FX.task1}`)).toContainText(cc(locale, "test", "workspace.pkgChip.complete"));
      await expect(page.locator(`#cc-task-tab-${FX.task2}`)).toContainText(cc(locale, "test", "workspace.pkgChip.complete"));
      await layoutOk(page);
    });

    test("module_package: an INVALID folder structure lists what is wrong", async ({ page, actions }) => {
      const bytes = invalidZip();
      const manifest = await manifestFor(bytes);
      expect(manifest.warnings.map((w) => w.code).sort()).toEqual(expect.arrayContaining(["missing_file", "no_step", "outside_results"]));
      actions.on((args) => {
        if (isRecord(args) && args[0].taskId === null) return { ok: true, uploadedAt: new Date().toISOString(), replacedCount: 0 };
        if (args?.length === 1 && args[0] === FX.attemptId) return { ok: true, manifest };
        return undefined;
      });
      await openFixture(page, locale, "workspace", "?mode=module_package");
      await page.locator('input[type="file"][accept=".zip"]').setInputFiles({ name: "wrong-layout.zip", mimeType: "application/zip", buffer: bytes });

      await expect(page.getByText(cc(locale, "test", "package.warningsTitle"))).toBeVisible();
      await expect(page.getByText(cc(locale, "test", "package.allGood"))).toHaveCount(0);
      const pkg = page.locator("section", { has: page.locator("#cc-package-title") });
      await expect(pkg.locator("li li").getByText(cc(locale, "test", "package.item.native_only"), { exact: true })).toHaveCount(1);
      await expect(pkg.locator("li li").getByText(cc(locale, "test", "package.item.missing"), { exact: true })).toHaveCount(1);
      await expect(page.locator(`#cc-task-tab-${FX.task1}`)).toContainText(cc(locale, "test", "workspace.pkgChip.partial"));
      await expect(page.locator(`#cc-task-tab-${FX.task2}`)).toContainText(cc(locale, "test", "workspace.pkgChip.missing"));
      await layoutOk(page);
    });

    test("timer: 14:59 shows the 15-minute warning, 0:59 the 1-minute warning", async ({ page }) => {
      await openFixture(page, locale, "workspace", "?mode=per_task&left=899");
      await expect(page.getByRole("timer")).toHaveText(/^1[45]:\d\d$/);
      await expect(page.getByText(cc(locale, "test", "workspace.warn15Title"))).toBeVisible();
      await layoutOk(page);

      await openFixture(page, locale, "workspace", "?mode=per_task&left=59");
      await expect(page.getByRole("timer")).toHaveText(/^00:[0-5]\d$/);
      await expect(page.getByText(cc(locale, "test", "workspace.warn1Title"))).toBeVisible();
      await layoutOk(page);
    });

    test("submitted: live status per task from the status endpoint", async ({ page }) => {
      await page.route(`**/api/cad-champions/attempts/${FX.attemptId}/status`, (route) =>
        route.fulfill({
          json: {
            tasks: [
              { id: FX.task1, state: "done" },
              { id: FX.task2, state: "waiting_trainer" },
            ],
          },
        }),
      );
      await openFixture(page, locale, "submitted");
      await expect(page.getByRole("heading", { name: cc(locale, "test", "submitted.title") })).toBeVisible();
      await expect(page.getByText(cc(locale, "test", "submitted.state.done"), { exact: true })).toBeVisible();
      await expect(page.getByText(cc(locale, "test", "submitted.state.waiting_trainer"), { exact: true })).toBeVisible();
      await layoutOk(page);
    });
  });
}

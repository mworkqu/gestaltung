// HTML -> PDF with headless Chromium when Playwright is installed (local /
// dev only: it is a devDependency and is NOT deployed). Returns null on
// Vercel or on any failure, so the caller serves printable HTML instead.
// Same approach as the results report (app/api/cad-champions/results/...).
// SERVER ONLY.

if (typeof window !== "undefined") throw new Error("lib/cad-champions/html-pdf.ts is server-only");

type PlaywrightLike = {
  chromium: {
    launch: (o?: { headless?: boolean }) => Promise<{
      newPage: () => Promise<{
        setContent: (html: string, o?: { waitUntil?: string; timeout?: number }) => Promise<void>;
        evaluate: <T>(fn: () => T | Promise<T>) => Promise<T>;
        pdf: (o: Record<string, unknown>) => Promise<Uint8Array>;
      }>;
      close: () => Promise<void>;
    }>;
  };
};

async function loadPlaywright(): Promise<PlaywrightLike | null> {
  if (process.env.CC_REPORT_PDF === "off") return null;
  try {
    const name = "playwright";
    const mod = (await import(/* webpackIgnore: true */ name)) as PlaywrightLike & { default?: PlaywrightLike };
    return mod?.chromium ? mod : (mod.default ?? null);
  } catch {
    return null;
  }
}

export async function htmlToPdf(html: string, opts: { landscape?: boolean } = {}): Promise<Uint8Array | null> {
  const pw = await loadPlaywright();
  if (!pw) return null;
  let browser: Awaited<ReturnType<PlaywrightLike["chromium"]["launch"]>> | null = null;
  try {
    browser = await pw.chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle", timeout: 20_000 });
    await page.evaluate(() => (document as Document).fonts.ready.then(() => true));
    return await page.pdf({ format: "A4", landscape: !!opts.landscape, printBackground: true, preferCSSPageSize: true });
  } catch (e) {
    console.warn("[cc-pdf] render failed, serving HTML:", e instanceof Error ? e.message.slice(0, 200) : "unknown");
    return null;
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

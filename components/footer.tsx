import { getTranslations } from "next-intl/server";

export async function Footer() {
  const t = await getTranslations("Footer");

  return (
    <footer className="container pb-8 pt-4">
      <div className="neu flex flex-col items-center justify-between gap-3 px-6 py-6 text-center sm:flex-row sm:text-start">
        <span className="text-sm text-mutedtext">{t("text")}</span>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-faint">
          © 2026 · Grid v4.1
        </span>
      </div>
    </footer>
  );
}

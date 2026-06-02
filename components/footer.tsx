import { getTranslations } from "next-intl/server";

export async function Footer() {
  const t = await getTranslations("Footer");

  return (
    <footer className="border-t border-border/70 bg-panel/60">
      <div className="container py-8 text-center text-sm text-faint">
        {t("text")}
      </div>
    </footer>
  );
}

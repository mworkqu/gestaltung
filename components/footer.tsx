import { getTranslations } from "next-intl/server";

export async function Footer() {
  const t = await getTranslations("Footer");
  const tBrand = await getTranslations("Brand");
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-border/60 bg-background/60">
      <div className="container flex flex-col items-center justify-between gap-3 py-8 text-center text-sm text-muted-foreground sm:flex-row sm:text-start">
        <p className="font-medium text-foreground/80">
          © {year} {tBrand("name")} — {t("rights")}
        </p>
        <p className="max-w-md text-xs text-muted-foreground/80">
          {t("tagline")}
        </p>
      </div>
    </footer>
  );
}

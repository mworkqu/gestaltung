import { getTranslations, setRequestLocale } from "next-intl/server";
import { UploadCloud, PencilRuler, ArrowUpRight } from "lucide-react";

import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

// The custom-manufacturing hub — the single destination the store landing's
// "Design" button points to. Public. Two paths: upload a ready CAD file
// (→ /design/upload) or hire us to draw it (→ /design/drawing).
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "DesignHub" });
  return { title: t("metaTitle"), description: t("metaDescription") };
}

export default async function DesignHubPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("DesignHub");
  const isRtl = locale === "ar";
  const mono = (extra = "") =>
    cn(isRtl ? "font-sans" : "font-mono uppercase tracking-[0.18em]", extra);

  const paths = [
    {
      href: "/design/upload",
      icon: UploadCloud,
      title: t("uploadTitle"),
      copy: t("uploadCopy"),
      meta: "STL · STEP · DXF · IGES",
      accent: true,
    },
    {
      href: "/design/drawing",
      icon: PencilRuler,
      title: t("drawingTitle"),
      copy: t("drawingCopy"),
      meta: t("drawingMeta"),
      accent: false,
    },
  ] as const;

  return (
    <div className="container space-y-8 py-10">
      <header className="max-w-2xl space-y-3">
        <p className={mono("text-[10px] text-cobalt")}>{t("kicker")}</p>
        <h1 className="text-3xl font-extrabold tracking-tight text-heading sm:text-4xl">
          {t("heading")}
        </h1>
        <p className="text-base leading-relaxed text-body">{t("subheading")}</p>
      </header>

      <div className="grid gap-6 md:grid-cols-2">
        {paths.map(({ href, icon: Icon, title, copy, meta, accent }) => (
          <Link key={href} href={href} className="neu neu-hover group flex flex-col p-7 sm:p-8">
            <span
              className={cn(
                "flex h-12 w-12 items-center justify-center rounded-2xl shadow-neu-sm",
                accent ? "bg-cobalt" : "bg-panel"
              )}
            >
              <Icon
                className={cn("h-6 w-6", accent ? "text-white" : "text-cobalt")}
                strokeWidth={1.5}
              />
            </span>

            <h2 className="mt-5 flex items-center gap-1.5 text-lg font-bold text-heading">
              {title}
              <ArrowUpRight
                className={cn(
                  "h-4 w-4 text-cobalt transition-transform group-hover:translate-x-0.5",
                  isRtl && "-scale-x-100"
                )}
              />
            </h2>
            <p className="mt-2 flex-1 text-sm leading-relaxed text-mutedtext">{copy}</p>
            <span className={mono("mt-5 text-[10px] text-faint")}>{meta}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

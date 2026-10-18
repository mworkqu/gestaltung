// Email: an engineering job is ready (0091). payload: { ref, job_kind, project_id, project_name }.
// Never name the CAD program we use: "your full STEP file is ready".

import { buildEmail, str, type RenderArgs, type Rendered } from "./layout";

const WHAT = {
  en: {
    step_model: "your full STEP file",
    pcb_gerber: "your PCB files (Gerber)",
    assembly: "your assembled electronics",
    cad_engineer: "your engineer-made CAD",
  },
  ar: {
    step_model: "ملف STEP الكامل لمشروعك",
    pcb_gerber: "ملفات اللوحة الإلكترونية (Gerber)",
    assembly: "إلكترونيات مشروعك المجمّعة",
    cad_engineer: "تصميم CAD من مهندسنا",
  },
} as const;

export function render({ locale, payload, links }: RenderArgs): Rendered {
  const name = str(payload.project_name);
  const kind = str(payload.job_kind) as keyof (typeof WHAT)["en"];
  const url = links.projectUrl ? `${links.projectUrl}/engineering` : links.projectsUrl;

  if (locale === "ar") {
    const what = WHAT.ar[kind] ?? WHAT.ar.step_model;
    return buildEmail({
      locale,
      links,
      subject: `جاهز: ${what}`,
      headline: `${what} جاهز.`,
      paragraphs: [
        `${name ? `لمشروع «${name}»: ` : ""}افتح صفحة الهندسة في مشروعك لتنزيل الملف. يمكنك تعديله في أي برنامج CAD ثم رفعه لنا لنصنّعه.`,
      ],
      cta: { label: "افتح صفحة الهندسة", url },
    });
  }
  const what = WHAT.en[kind] ?? WHAT.en.step_model;
  return buildEmail({
    locale,
    links,
    subject: `Ready: ${what}`,
    headline: `${what.charAt(0).toUpperCase()}${what.slice(1)} is ready.`,
    paragraphs: [
      `${name ? `For “${name}”: ` : ""}open your project's Engineering page to download it. You can edit it in any CAD software and upload it back for us to manufacture.`,
    ],
    cta: { label: "Open the Engineering page", url },
  });
}

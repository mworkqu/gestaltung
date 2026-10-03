// Email: the user's first saved project. payload: { ref, project_id, project_name }.
// Button goes to the project when we have its link, else to the projects list.

import { buildEmail, str, type RenderArgs, type Rendered } from "./layout";

export function render({ locale, payload, links }: RenderArgs): Rendered {
  const name = str(payload.project_name);
  const url = links.projectUrl ?? links.projectsUrl;
  const hasProject = !!links.projectUrl;

  if (locale === "ar") {
    return buildEmail({
      locale,
      links,
      subject: "تم حفظ مشروعك",
      headline: "أهلًا بك — تم حفظ مشروعك.",
      paragraphs: [
        `${name ? `مشروعك «${name}» محفوظ` : "مشروعك محفوظ"} في حسابك على Gestaltung360. يمكنك العودة إليه في أي وقت من صفحة مشاريعي.`,
      ],
      cta: { label: hasProject ? "افتح مشروعي" : "افتح مشاريعي", url },
    });
  }
  return buildEmail({
    locale,
    links,
    subject: "Your project is saved",
    headline: "Welcome — your project is saved.",
    paragraphs: [
      `${name ? `Your project “${name}” is saved` : "Your project is saved"} in your Gestaltung360 account. You can come back to it any time from My projects.`,
    ],
    cta: { label: hasProject ? "Open my project" : "Open my projects", url },
  });
}

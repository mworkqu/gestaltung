import { redirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";

import { getAuthUser, getSessionContext } from "@/lib/auth/get-session";
import { signInHref } from "@/lib/auth/next-path";
import { MessagesScope } from "@/components/i18n/messages-scope";
import { metaFor } from "@/lib/meta";

// A teacher's own area: per-request session, never cached. The PUBLIC /schools
// page is one level up and stays public on purpose — this gate covers only
// /schools/classes and below.
export const dynamic = "force-dynamic";

export const generateMetadata = metaFor("schoolClasses");

export default async function SchoolClassesLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  // Single auth gate for every /schools/classes/* route. A GUEST (anonymous
  // session) is not a teacher either: create_school_class() refuses an
  // anonymous or unconfirmed account ('sign_in'), so send them to sign in
  // rather than show a page every action would reject. ?next= brings them
  // straight back (lib/auth/next-path.ts).
  const user = await getAuthUser();
  if (!user || user.is_anonymous === true) {
    redirect(signInHref(locale, `/${locale}/schools/classes`));
  }
  const session = await getSessionContext(user);
  if (!session) {
    redirect(signInHref(locale, `/${locale}/schools/classes`));
  }

  return (
    <MessagesScope scope="schools">
      <div className="container py-10">{children}</div>
    </MessagesScope>
  );
}

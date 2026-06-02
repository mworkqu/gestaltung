import { redirect } from "next/navigation";
import { routing } from "@/i18n/routing";

// Middleware normally redirects "/" to the default locale. This is a
// belt-and-braces fallback in case middleware is bypassed.
export default function RootPage() {
  redirect(`/${routing.defaultLocale}`);
}

"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

import { useToast } from "@/components/cad-champions/ui";

// requireCcStaff / requireCcAdmin send a user without the role to
// /dashboard?denied=1. Mounted once in the CC layout (inside <Suspense>): shows
// the "no access" toast, then removes ?denied from the address bar so a
// reload doesn't show it again.
export function CcDeniedToast() {
  const params = useSearchParams();
  const toast = useToast();
  const t = useTranslations("CC.auth.denied");
  const shown = React.useRef(false);

  React.useEffect(() => {
    if (shown.current || params.get("denied") !== "1") return;
    shown.current = true;
    toast.error(t("title"), t("body"));
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("denied");
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    } catch {
      // Leave the URL as it is.
    }
  }, [params, toast, t]);

  return null;
}

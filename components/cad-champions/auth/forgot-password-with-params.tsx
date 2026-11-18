"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";

import type { Locale } from "@/i18n/routing";

import { CcForgotPasswordForm } from "./password-reset";

// The forgot-password page is prerendered; ?expired=1 (set by /api/auth/callback
// when an emailed link no longer works) is read here, in the browser. The
// Suspense fallback is the same form without the notice, so nothing jumps
// except the notice appearing above it.

type Props = { locale: Locale; turnstileEnabled: boolean };

function WithParams({ locale, turnstileEnabled }: Props) {
  const expired = useSearchParams().get("expired") === "1";
  return <CcForgotPasswordForm locale={locale} expired={expired} turnstileEnabled={turnstileEnabled} />;
}

export function CcForgotPasswordWithParams(props: Props) {
  return (
    <Suspense fallback={<CcForgotPasswordForm locale={props.locale} expired={false} turnstileEnabled={props.turnstileEnabled} />}>
      <WithParams {...props} />
    </Suspense>
  );
}

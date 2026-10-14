"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { useToast } from "@/components/cad-champions/ui";

// Runs an admin server action with a busy flag, a toast and a refresh.
// Error codes come back as { ok: false, error, detail }: known details get
// their own sentence (CC.admin.tests.errors.<detail>), field codes are named,
// everything else uses CC.admin.common.errors.<error>.

export type ActionFail = { ok: false; error: string; detail?: string };
export type AnyResult = { ok: true; data?: unknown } | ActionFail;

const DETAILS = new Set([
  "has_results",
  "blocked",
  "grader_not_configured",
  "grader_failed",
  "file_missing",
  "incomplete",
  "part_names",
  "path",
  "texts",
  "items",
  "skill_area",
  "sync",
  "reference_missing",
  "download_failed",
  "grader_error",
  "not_configured",
  "unavailable",
]);

export const FIELD_CODES = new Set([
  "slug",
  "title_en",
  "title_ar",
  "type",
  "time_limit_minutes",
  "grace_seconds",
  "retake_cooldown_days",
  "upload_mode",
  "skill_area_id",
  "competition_module",
  "expected_upload",
  "max_points",
  "grading_mode",
  "grader_mode",
  "density_kg_m3",
  "tolerances",
  "level_id",
  "sort",
  "pass_mark",
  "estimated_minutes",
  "solution_video_id",
  "description_en",
  "description_ar",
  "skill_area",
  "module",
  "points",
  "method",
  "judgement_method",
  "partial_rule",
  "check_key",
  "auto_check_key",
  "unknown_folder",
  "no_folder",
  "no_name",
  "unsafe",
  "bad_chars",
  "too_long",
  "duplicate",
  "too_many",
  "unknown_task",
  "empty",
]);

export function useErrorText() {
  const t = useTranslations("CC.admin.tests");
  const tc = useTranslations("CC.admin.common");
  return React.useCallback(
    (res: ActionFail): string => {
      const d = res.detail ?? "";
      if (d && /^E_[A-Z_]+$/.test(d)) return t("errors.graderCode", { code: d });
      if (res.error !== "invalid" && d && DETAILS.has(d)) return t(`errors.${d}`);
      if (res.error === "invalid" && d) {
        if (DETAILS.has(d)) return t(`errors.${d}`);
        const fields = [...new Set(d.split(","))].filter((f) => FIELD_CODES.has(f));
        if (fields.length > 0) return t("errors.checkFields", { fields: fields.map((f) => t(`fields.${f}`)).join(", ") });
      }
      const key = ["forbidden", "unavailable", "not_set_up", "invalid", "not_found", "conflict", "error"].includes(res.error) ? res.error : "error";
      return tc(`errors.${key}`);
    },
    [t, tc],
  );
}

/**
 * const { run, busy } = useAdminAction();
 * await run(() => saveX(...), { success: message })  -> the result (ok or not)
 */
export function useAdminAction() {
  const router = useRouter();
  const toast = useToast();
  const errorText = useErrorText();
  const [busy, setBusy] = React.useState(false);

  const run = React.useCallback(
    async <R extends AnyResult>(fn: () => Promise<R>, opts: { success?: string; successBody?: string; refresh?: boolean; errorTitle?: string } = {}): Promise<R | null> => {
      setBusy(true);
      try {
        const res = await fn();
        if (res.ok) {
          if (opts.success) toast.success(opts.success, opts.successBody);
          if (opts.refresh !== false) router.refresh();
        } else {
          const text = errorText(res as ActionFail);
          if (opts.errorTitle) toast.error(opts.errorTitle, text);
          else toast.error(text);
        }
        return res;
      } catch (e) {
        console.error("[cc-admin] action failed:", e instanceof Error ? e.message : "unknown");
        toast.error(errorText({ ok: false, error: "error" }));
        return null;
      } finally {
        setBusy(false);
      }
    },
    [router, toast, errorText],
  );

  return { run, busy, errorText };
}

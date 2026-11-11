"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";

import { createTestAction } from "@/app/[locale]/cad-champions/admin/tests/actions";
import { BilingualField, Field, inputCls } from "@/components/cad-champions/admin/fields";
import { Button } from "@/components/cad-champions/ui";
import type { Locale } from "@/i18n/routing";
import { slugify } from "@/lib/cad-champions/admin/test-builder";
import { CC_TEST_TYPES } from "@/lib/cad-champions/db/types";
import { ccPath } from "@/lib/cad-champions/routes";

import { useAdminAction } from "./use-admin-action";

// New test: slug, titles EN + AR, type. The rest is edited on the test page.

export function TestCreateForm() {
  const t = useTranslations("CC.admin.tests");
  const tc = useTranslations("CC.admin.common");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const { run, busy } = useAdminAction();
  const [titleEn, setTitleEn] = React.useState("");
  const [titleAr, setTitleAr] = React.useState("");
  const [slug, setSlug] = React.useState("");
  const [slugTouched, setSlugTouched] = React.useState(false);
  const [type, setType] = React.useState<string>("practice");

  const onTitleEn = (v: string) => {
    setTitleEn(v);
    if (!slugTouched) setSlug(slugify(v));
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const res = await run(() => createTestAction({ slug, title_en: titleEn, title_ar: titleAr, type }), { success: t("create.done"), successBody: t("create.doneBody"), refresh: false });
    if (res?.ok) router.push(ccPath(locale, `/admin/tests/${res.data.slug}`));
  }

  return (
    <form onSubmit={submit} className="neu flex flex-col gap-4 p-5 sm:p-6">
      <BilingualField label={t("fields.title")} required en={{ value: titleEn, onChange: onTitleEn }} ar={{ value: titleAr, onChange: setTitleAr }} maxLength={200} />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label={t("fields.slug")} hint={t("create.slugHint")}>
          <input
            className={inputCls}
            dir="ltr"
            required
            pattern="[a-z0-9-]{1,80}"
            value={slug}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(e.target.value.toLowerCase());
            }}
          />
        </Field>
        <Field label={t("fields.type")} hint={t("create.typeHint")}>
          <select className={inputCls} value={type} onChange={(e) => setType(e.target.value)}>
            {CC_TEST_TYPES.map((x) => (
              <option key={x} value={x}>
                {t(`types.${x}`)}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div>
        <Button type="submit" loading={busy} loadingText={tc("creating")}>
          {t("create.submit")}
        </Button>
      </div>
    </form>
  );
}

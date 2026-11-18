"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Eye, EyeOff, MessageSquareQuote, Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  createTestimonialAction,
  deleteTestimonialAction,
  moveTestimonialAction,
  setTestimonialPublishedAction,
  updateTestimonialAction,
} from "@/app/[locale]/cad-champions/admin/landing/actions";
import { BilingualField } from "@/components/cad-champions/admin/fields";
import { Alert, Button, ConfirmDialog, EmptyState, StatusChip, useToast } from "@/components/cad-champions/ui";
import { TESTIMONIAL_LIMITS, type TestimonialRow } from "@/lib/cad-champions/admin/testimonials";

type Form = { quote_en: string; quote_ar: string; name_en: string; name_ar: string; role_en: string; role_ar: string };

const BLANK: Form = { quote_en: "", quote_ar: "", name_en: "", name_ar: "", role_en: "", role_ar: "" };

const toForm = (r: TestimonialRow): Form => ({
  quote_en: r.quote_en,
  quote_ar: r.quote_ar,
  name_en: r.name_en,
  name_ar: r.name_ar,
  role_en: r.role_en ?? "",
  role_ar: r.role_ar ?? "",
});

/** List, create, edit, reorder, publish and delete landing testimonials. */
export function TestimonialsManager({ initial }: { initial: TestimonialRow[] }) {
  const t = useTranslations("CC.admin.landing.testimonials");
  const tc = useTranslations("CC.admin.common");
  const toast = useToast();
  const router = useRouter();
  const [rows, setRows] = React.useState(initial);
  const [adding, setAdding] = React.useState(false);
  const [editing, setEditing] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [toDelete, setToDelete] = React.useState<TestimonialRow | null>(null);

  React.useEffect(() => {
    setRows(initial);
  }, [initial]);

  const published = rows.filter((r) => r.is_published).length;

  async function run(id: string, fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string, after?: () => void) {
    setBusy(id);
    try {
      const res = await fn();
      if (res.ok) {
        toast.success(okMsg);
        after?.();
        router.refresh();
      } else {
        toast.error(tc(`errors.${res.error ?? "error"}`));
      }
    } catch {
      toast.error(tc("errors.error"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <StatusChip tone={published > 0 ? "success" : "neutral"}>{published > 0 ? t("sectionShown", { count: String(published) }) : t("sectionHidden")}</StatusChip>
        {!adding ? (
          <Button type="button" variant="secondary" size="sm" onClick={() => setAdding(true)}>
            <Plus aria-hidden="true" strokeWidth={1.75} className="h-4 w-4" />
            {t("add")}
          </Button>
        ) : null}
      </div>

      {adding ? (
        <TestimonialForm
          title={t("newTitle")}
          initial={BLANK}
          submitLabel={tc("create")}
          submittingLabel={tc("creating")}
          onCancel={() => setAdding(false)}
          onSubmit={async (f) => {
            const res = await createTestimonialAction(f);
            if (res.ok) {
              toast.success(t("created"));
              setAdding(false);
              router.refresh();
            }
            return res;
          }}
        />
      ) : null}

      {rows.length === 0 && !adding ? (
        <EmptyState icon={MessageSquareQuote} title={t("empty.title")} description={t("empty.body")} />
      ) : (
        <ul className="space-y-3">
          {rows.map((r, i) => (
            <li key={r.id} className="neu space-y-3 p-4">
              {editing === r.id ? (
                <TestimonialForm
                  title={t("editTitle")}
                  initial={toForm(r)}
                  submitLabel={tc("save")}
                  submittingLabel={tc("saving")}
                  onCancel={() => setEditing(null)}
                  onSubmit={async (f) => {
                    const res = await updateTestimonialAction(r.id, f);
                    if (res.ok) {
                      toast.success(tc("saved"));
                      setEditing(null);
                      router.refresh();
                    }
                    return res;
                  }}
                />
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusChip tone={r.is_published ? "success" : "neutral"}>{r.is_published ? tc("published") : tc("draft")}</StatusChip>
                    <span className="text-xs text-mutedtext">#{i + 1}</span>
                  </div>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <blockquote className="min-w-0 rounded-xl bg-panel p-3 text-sm text-body" lang="en" dir="ltr">
                      {r.quote_en}
                      <footer className="mt-2 text-xs font-semibold text-mutedtext">
                        {r.name_en}
                        {r.role_en ? `, ${r.role_en}` : ""}
                      </footer>
                    </blockquote>
                    <blockquote className="min-w-0 rounded-xl bg-panel p-3 text-sm text-body" lang="ar" dir="rtl">
                      {r.quote_ar}
                      <footer className="mt-2 text-xs font-semibold text-mutedtext">
                        {r.name_ar}
                        {r.role_ar ? `، ${r.role_ar}` : ""}
                      </footer>
                    </blockquote>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button type="button" variant="secondary" size="sm" disabled={i === 0 || busy !== null} onClick={() => run(r.id, () => moveTestimonialAction(r.id, "up"), tc("saved"))}>
                      <ArrowUp aria-hidden="true" strokeWidth={1.75} className="h-4 w-4" />
                      {tc("moveUp")}
                    </Button>
                    <Button type="button" variant="secondary" size="sm" disabled={i === rows.length - 1 || busy !== null} onClick={() => run(r.id, () => moveTestimonialAction(r.id, "down"), tc("saved"))}>
                      <ArrowDown aria-hidden="true" strokeWidth={1.75} className="h-4 w-4" />
                      {tc("moveDown")}
                    </Button>
                    <Button type="button" variant="secondary" size="sm" onClick={() => setEditing(r.id)}>
                      <Pencil aria-hidden="true" strokeWidth={1.75} className="h-4 w-4" />
                      {tc("edit")}
                    </Button>
                    <Button
                      type="button"
                      variant={r.is_published ? "secondary" : "primary"}
                      size="sm"
                      loading={busy === r.id}
                      loadingText={tc("saving")}
                      onClick={() => run(r.id, () => setTestimonialPublishedAction(r.id, !r.is_published), r.is_published ? t("unpublished") : t("publishedNow"))}
                    >
                      {r.is_published ? <EyeOff aria-hidden="true" strokeWidth={1.75} className="h-4 w-4" /> : <Eye aria-hidden="true" strokeWidth={1.75} className="h-4 w-4" />}
                      {r.is_published ? tc("unpublish") : tc("publish")}
                    </Button>
                    <Button type="button" variant="danger" size="sm" onClick={() => setToDelete(r)}>
                      <Trash2 aria-hidden="true" strokeWidth={1.75} className="h-4 w-4" />
                      {tc("delete")}
                    </Button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(o) => (o ? undefined : setToDelete(null))}
        title={t("deleteTitle")}
        consequence={t("deleteConsequence", { name: toDelete?.name_en ?? "" })}
        confirmLabel={tc("delete")}
        tone="danger"
        onConfirm={async () => {
          const target = toDelete;
          if (!target) return;
          await run(target.id, () => deleteTestimonialAction(target.id), t("deleted"), () => setToDelete(null));
        }}
      />
    </div>
  );
}

function TestimonialForm({
  title,
  initial,
  submitLabel,
  submittingLabel,
  onCancel,
  onSubmit,
}: {
  title: string;
  initial: Form;
  submitLabel: string;
  submittingLabel: string;
  onCancel: () => void;
  onSubmit: (f: Form) => Promise<{ ok: boolean; error?: string; detail?: string }>;
}) {
  const t = useTranslations("CC.admin.landing.testimonials");
  const tc = useTranslations("CC.admin.common");
  const [f, setF] = React.useState<Form>(initial);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const set = (k: keyof Form) => (v: string) => setF((prev) => ({ ...prev, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await onSubmit(f);
      if (!res.ok) setError(res.error === "invalid" ? t("needBoth") : tc(`errors.${res.error ?? "error"}`));
    } catch {
      setError(tc("errors.error"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="neu space-y-4 p-4">
      <h3 className="text-base font-bold text-heading">{title}</h3>
      <BilingualField label={t("fields.quote")} multiline rows={4} required maxLength={TESTIMONIAL_LIMITS.quote} en={{ value: f.quote_en, onChange: set("quote_en") }} ar={{ value: f.quote_ar, onChange: set("quote_ar") }} />
      <BilingualField label={t("fields.name")} required maxLength={TESTIMONIAL_LIMITS.name} en={{ value: f.name_en, onChange: set("name_en") }} ar={{ value: f.name_ar, onChange: set("name_ar") }} />
      <BilingualField label={t("fields.role")} hint={t("fields.roleHint")} maxLength={TESTIMONIAL_LIMITS.role} en={{ value: f.role_en, onChange: set("role_en") }} ar={{ value: f.role_ar, onChange: set("role_ar") }} />
      {error ? <Alert tone="error" title={error} /> : null}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" loading={saving} loadingText={submittingLabel}>
          {submitLabel}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>
          {tc("cancel")}
        </Button>
      </div>
    </form>
  );
}

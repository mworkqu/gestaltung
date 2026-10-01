"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";

import { useRouter } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import { ensureSession, isGuest } from "@/lib/supabase/guest";
import { isValidPhone, normalizePhone } from "@/lib/phone";
import { Button } from "@/components/ui/button";

// Starting a project is the one thing that must never hit a sign-in wall. The
// anonymous session is minted here, at the first write — not on page load — so
// a visitor who only browses never costs an MAU.
//
// `forDrawing` (audit #11, "help me draw it"): the same project, plus what to
// draw and a WhatsApp number; the owner is told so the drawing can be quoted.
export function NewProjectForm({ forDrawing = false }: { forDrawing?: boolean }) {
  const t = useTranslations("Projects");
  const locale = useLocale();
  const router = useRouter();

  const [name, setName] = useState("");
  const [brief, setBrief] = useState("");
  const [phone, setPhone] = useState("");
  // A visitor without an account gives a WhatsApp number instead (owner,
  // 2026-09-29: "a phone number is enough"). It's saved on their profile, so
  // the project has a way to reach them. Signed-in accounts skip it.
  const [needsPhone, setNeedsPhone] = useState(true);
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      if (!isGuest(data.user)) return setNeedsPhone(false);
      const { data: prof } = await supabase.from("profiles").select("phone").eq("id", data.user.id).maybeSingle();
      if (prof?.phone) setNeedsPhone(false);
    });
  }, []);
  const askPhone = needsPhone || forDrawing;
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t("nameRequired"));
      return;
    }
    if (forDrawing && !brief.trim()) {
      setError(t("drawingRequired"));
      return;
    }
    if (askPhone && !isValidPhone(phone)) {
      setError(t("phoneRequired"));
      return;
    }

    setError(null);
    setLoading(true);

    try {
      const user = await ensureSession();
      const supabase = createClient();
      const { data, error: insertError } = await supabase
        .from("projects")
        .insert({ user_id: user.id, name: trimmed, ...(forDrawing ? { brief: brief.trim() } : {}) })
        .select("id")
        .single();

      if (insertError) throw insertError;

      if (askPhone && isGuest(user)) {
        // Best-effort: the project exists either way.
        await supabase.from("profiles").update({ phone: normalizePhone(phone) }).eq("id", user.id);
      }

      if (forDrawing) {
        // Best-effort: the project exists either way.
        await fetch("/api/store-lead", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            source: "drawing_request",
            name: trimmed,
            phone: phone.trim(),
            locale,
            message: `Drawing request for project "${trimmed}" (${data.id}).

${brief.trim()}`,
          }),
        }).catch(() => {});
      }

      // refresh() so the server sees the session cookie the anonymous sign-in
      // just wrote, before the workspace renders.
      router.push(`/projects/${data.id}`);
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : (err as { message?: string })?.message ?? String(err);
      // 0042: the database refuses a 4th active project.
      setError(message.includes("project_limit") ? t("limitReached") : message);
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="neu space-y-5 p-6 sm:p-8">
      <div className="space-y-2">
        <label htmlFor="project-name" className="block text-sm font-medium text-heading">
          {t("nameLabel")}
        </label>
        <input
          id="project-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("namePlaceholder")}
          autoFocus
          className="w-full rounded-xl border border-white/60 bg-panel px-4 py-3 text-base text-heading shadow-neu-inset outline-none placeholder:text-faint focus:ring-2 focus:ring-cobalt/60"
        />
      </div>

      {forDrawing && (
        <>
          <div className="space-y-2">
            <label htmlFor="project-brief" className="block text-sm font-medium text-heading">
              {t("drawingBriefLabel")}
            </label>
            <textarea
              id="project-brief"
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              rows={5}
              placeholder={t("drawingBriefPlaceholder")}
              className="w-full rounded-xl border border-white/60 bg-panel px-4 py-3 text-base text-heading shadow-neu-inset outline-none placeholder:text-faint focus:ring-2 focus:ring-cobalt/60"
            />
          </div>
        </>
      )}

      {askPhone && (
        <div className="space-y-2">
          <label htmlFor="project-phone" className="block text-sm font-medium text-heading">
            {t("drawingPhoneLabel")}
          </label>
          <input
            id="project-phone"
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+974 5555 5555"
            dir="ltr"
            className="w-full rounded-xl border border-white/60 bg-panel px-4 py-3 text-base text-heading shadow-neu-inset outline-none placeholder:text-faint focus:ring-2 focus:ring-cobalt/60"
          />
          <p className="text-[11px] text-mutedtext">{t(forDrawing ? "drawingPhoneHint" : "phoneHint")}</p>
        </div>
      )}

      {error && <p className="text-sm font-medium text-destructive">{error}</p>}

      <Button type="submit" size="lg" disabled={loading} className="w-full sm:w-auto">
        {loading ? (
          <>
            <Loader2 className="me-2 h-4 w-4 animate-spin" />
            {t("creating")}
          </>
        ) : (
          t("create")
        )}
      </Button>
    </form>
  );
}

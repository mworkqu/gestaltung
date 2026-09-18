"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";

import { useRouter } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import { ensureSession } from "@/lib/supabase/guest";
import { Button } from "@/components/ui/button";

// Starting a project is the one thing that must never hit a sign-in wall. The
// anonymous session is minted here, at the first write — not on page load — so
// a visitor who only browses never costs an MAU.
export function NewProjectForm() {
  const t = useTranslations("Projects");
  const router = useRouter();

  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t("nameRequired"));
      return;
    }

    setError(null);
    setLoading(true);

    try {
      const user = await ensureSession();
      const supabase = createClient();
      const { data, error: insertError } = await supabase
        .from("projects")
        .insert({ user_id: user.id, name: trimmed })
        .select("id")
        .single();

      if (insertError) throw insertError;

      // refresh() so the server sees the session cookie the anonymous sign-in
      // just wrote, before the workspace renders.
      router.push(`/projects/${data.id}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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

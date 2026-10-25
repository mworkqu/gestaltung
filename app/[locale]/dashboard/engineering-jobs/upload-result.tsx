"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ENGINEERING_BUCKET, ENGINEERING_MAX_BYTES } from "@/lib/engineering/config";
import { loadSupabase } from "@/lib/supabase/lazy";
import { markJobReady } from "./actions";
import { safeFileName } from "@/lib/storage/paths";

type Labels = {
  file: string;
  notePlaceholder: string;
  submit: string;
  uploading: string;
  tooBig: string;
  failed: string;
};

export function UploadResult({ jobId, locale, labels }: { jobId: string; locale: string; labels: Labels }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || busy) return;
    if (file.size > ENGINEERING_MAX_BYTES) {
      setError(labels.tooBig);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const supabase = await loadSupabase();
      const path = `jobs/${jobId}/${Date.now()}-${safeFileName(file.name)}`;
      const up = await supabase.storage.from(ENGINEERING_BUCKET).upload(path, file, { upsert: false });
      if (up.error) throw new Error("upload");
      const res = await markJobReady({ jobId, path, name: file.name, note, locale });
      if (!res.ok) throw new Error("rpc");
      setFile(null);
      setNote("");
      router.refresh();
    } catch {
      setError(labels.failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex min-w-[220px] flex-col gap-2">
      <label className="text-[11px] text-mutedtext">
        {labels.file}
        <input
          type="file"
          required
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="mt-1 block w-full text-[12px] text-body file:me-2 file:rounded-md file:border-0 file:bg-panel file:px-2 file:py-1 file:text-[12px] file:shadow-neu-sm"
        />
      </label>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={500}
        placeholder={labels.notePlaceholder}
        className="rounded-lg bg-panel px-2 py-1 text-[12px] text-heading shadow-neu-inset outline-none"
      />
      <Button type="submit" size="sm" disabled={!file || busy}>
        {busy ? labels.uploading : labels.submit}
      </Button>
      {error && <p className="text-[12px] font-medium text-destructive">{error}</p>}
    </form>
  );
}

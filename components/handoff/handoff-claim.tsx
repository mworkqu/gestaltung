"use client";

// Opens a project sent from the client's own AI chat: guest session -> claim
// RPC -> (phone card when the lead has no number) -> the Studio. All states
// are drawn by HandoffView; this file only runs the flow.

import { useCallback, useEffect, useRef, useState } from "react";

import { useRouter } from "@/i18n/navigation";
import { track } from "@/lib/analytics";
import { isValidPhone, normalizePhone } from "@/lib/phone";
import { claimPluginHandoff, setHandoffPhone } from "@/lib/plugin/client/handoff";
import { ensureSession } from "@/lib/supabase/guest";
import { loadSupabase } from "@/lib/supabase/lazy";

import { HandoffView, type HandoffViewState } from "./handoff-view";

export function HandoffClaim({ token }: { token: string }) {
  const router = useRouter();
  const [state, setState] = useState<HandoffViewState>("loading");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  const open = useCallback(
    (id: string) => {
      // The i18n router adds the locale. refresh() so the server sees the new session cookie.
      router.replace(`/projects/${id}/studio?step=enclosure`);
      router.refresh();
    },
    [router],
  );

  const run = useCallback(async () => {
    setState("loading");
    track("handoff_opened", {});
    try {
      await ensureSession();
    } catch {
      setState("error");
      return;
    }
    const supabase = await loadSupabase();
    const res = await claimPluginHandoff(supabase, token);
    if (!res.ok) {
      setState(
        res.reason === "bad_token"
          ? "expired"
          : res.reason === "project_limit"
            ? "limit"
            : res.reason === "not_ready"
              ? "notReady"
              : "error",
      );
      return;
    }
    setProjectId(res.projectId);
    if (res.needsPhone) {
      setState("phone");
      return;
    }
    track("handoff_claimed", { source: "plugin" });
    open(res.projectId);
  }, [token, open]);

  useEffect(() => {
    // Strict mode runs effects twice; the claim must run once.
    if (started.current) return;
    started.current = true;
    void run();
  }, [run]);

  function finish() {
    if (!projectId) return;
    track("handoff_claimed", { source: "plugin" });
    open(projectId);
  }

  async function save() {
    if (!isValidPhone(phone)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setFailed(false);
    setBusy(true);
    const supabase = await loadSupabase();
    const res = await setHandoffPhone(supabase, token, normalizePhone(phone));
    setBusy(false);
    if (!res.ok) {
      if (res.reason === "bad_phone") setInvalid(true);
      else setFailed(true);
      return;
    }
    track("phone_captured", { where: "quote" });
    finish();
  }

  return (
    <HandoffView
      state={state}
      onRetry={() => void run()}
      phone={{ value: phone, onChange: setPhone, onSave: () => void save(), onSkip: finish, busy, invalid, failed }}
    />
  );
}

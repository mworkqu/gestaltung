"use client";

// Read a text out loud with the browser's own voice (free, nothing leaves the
// device). Arabic uses an Arabic voice when the device has one. Hidden where
// the browser has no speech synthesis.

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Square, Volume2 } from "lucide-react";

import { cn } from "@/lib/utils";

export function ReadAloud({ text, className }: { text: string; className?: string }) {
  const t = useTranslations("Prototyping");
  const locale = useLocale();
  const [supported, setSupported] = useState(false);
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    setSupported(typeof window !== "undefined" && "speechSynthesis" in window);
    return () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, []);

  if (!supported || !text.trim()) return null;

  function toggle() {
    const synth = window.speechSynthesis;
    if (speaking) {
      synth.cancel();
      setSpeaking(false);
      return;
    }
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = locale === "ar" ? "ar-SA" : "en-GB";
    const voice = synth.getVoices().find((v) => v.lang.toLowerCase().startsWith(locale === "ar" ? "ar" : "en"));
    if (voice) u.voice = voice;
    u.rate = 0.95;
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    setSpeaking(true);
    synth.speak(u);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={speaking}
      title={speaking ? t("readAloudStop") : t("readAloud")}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11.5px] font-semibold text-cobalt shadow-neu-sm transition-colors hover:bg-panel",
        className
      )}
    >
      {speaking ? <Square className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
      {speaking ? t("readAloudStop") : t("readAloud")}
    </button>
  );
}

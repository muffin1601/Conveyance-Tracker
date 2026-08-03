"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Languages, Loader2 } from "lucide-react";
import { t, type Lang } from "@/lib/i18n";
import { setLanguage } from "@/app/actions/language";
import { cn } from "@/lib/utils";

/**
 * One tap to flip the Check In page between English and Hindi. Shows the
 * OTHER language as the label ("हिंदी" while in English, "English" while in
 * Hindi) — that's the language someone is about to switch TO, which is the
 * more useful thing to read on a button than the one already showing.
 */
export function LanguageToggle({ lang }: { lang: Lang }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function toggle() {
    if (pending) return;
    const next: Lang = lang === "en" ? "hi" : "en";
    start(async () => {
      await setLanguage(next);
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      aria-label="Switch language"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition",
        "hover:bg-bg disabled:opacity-60",
      )}
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Languages className="h-4 w-4" />}
      {t(lang, "languageToggle")}
    </button>
  );
}

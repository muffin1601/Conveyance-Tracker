"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { t, type Lang, type DictKey } from "@/lib/i18n";
import { LanguageToggle } from "./LanguageToggle";

const TABS: { href: string; key: DictKey }[] = [
  { href: "/app", key: "navCheckIn" },
  { href: "/app/admin", key: "navAdmin" },
  { href: "/app/settings", key: "navSettings" },
];

export function TopNav({ lang }: { lang: Lang }) {
  const pathname = usePathname();
  return (
    <nav className="border-b">
      <div className="max-w-6xl mx-auto w-full px-4 md:px-8 flex items-center justify-between gap-2">
        <div className="flex gap-1">
          {TABS.map((tab) => {
            const active = tab.href === "/app" ? pathname === "/app" : pathname.startsWith(tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={cn(
                  "px-4 py-3 text-sm font-medium border-b-2 -mb-px transition",
                  active
                    ? "border-brand text-fg"
                    : "border-transparent text-muted hover:text-fg",
                )}
              >
                {t(lang, tab.key)}
              </Link>
            );
          })}
        </div>
        <LanguageToggle lang={lang} />
      </div>
    </nav>
  );
}

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
        {/* The tab row scrolls within itself on a narrow phone rather than
            pushing the page wider than the screen. */}
        <div className="flex min-w-0 gap-1 overflow-x-auto">
          {TABS.map((tab) => {
            const active = tab.href === "/app" ? pathname === "/app" : pathname.startsWith(tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={cn(
                  "shrink-0 whitespace-nowrap px-3 py-3 text-sm font-medium border-b-2 -mb-px transition sm:px-4",
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
        <div className="shrink-0">
          <LanguageToggle lang={lang} />
        </div>
      </div>
    </nav>
  );
}

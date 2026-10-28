"use client";

import { useSyncExternalStore } from "react";
import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { t, type Lang, type DictKey } from "@/lib/i18n";
import { LanguageToggle } from "./LanguageToggle";

const TABS: { href: string; key: DictKey }[] = [
  { href: "/app", key: "navCheckIn" },
  { href: "/app/admin", key: "navAdmin" },
  { href: "/app/settings", key: "navSettings" },
];

const subscribeHydration = () => () => {};
const getClientHydration = () => true;
const getServerHydration = () => false;

function LinkProgress() {
  const { pending } = useLinkStatus();
  return pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-label="Loading" /> : null;
}

export function TopNav({ lang }: { lang: Lang }) {
  const pathname = usePathname();
  const hydrated = useSyncExternalStore(subscribeHydration, getClientHydration, getServerHydration);
  return (
    <nav className="border-b">
      <div className="max-w-6xl mx-auto w-full px-4 md:px-8 flex items-center justify-between gap-2">
        {/* The tab row scrolls within itself on a narrow phone rather than
            pushing the page wider than the screen. */}
        <div className="flex min-w-0 gap-1 overflow-x-auto">
          {TABS.map((tab) => {
            // Rewrites can make the browser pathname differ from the server's
            // initial route. Keep the first client render identical to SSR.
            const active = hydrated && (tab.href === "/app" ? pathname === "/app" : pathname.startsWith(tab.href));
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3 py-3 text-sm font-medium border-b-2 -mb-px transition sm:px-4",
                  active
                    ? "border-brand text-fg"
                    : "border-transparent text-muted hover:text-fg",
                )}
              >
                {t(lang, tab.key)}
                <LinkProgress />
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

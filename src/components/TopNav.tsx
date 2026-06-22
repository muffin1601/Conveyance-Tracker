"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/app", label: "Check In" },
  { href: "/app/admin", label: "Admin" },
  { href: "/app/settings", label: "Settings" },
];

export function TopNav() {
  const pathname = usePathname();
  return (
    <nav className="border-b">
      <div className="max-w-6xl mx-auto w-full px-4 md:px-8 flex gap-1">
        {TABS.map((t) => {
          const active = t.href === "/app" ? pathname === "/app" : pathname.startsWith(t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              className={cn(
                "px-4 py-3 text-sm font-medium border-b-2 -mb-px transition",
                active
                  ? "border-brand text-fg"
                  : "border-transparent text-muted hover:text-fg",
              )}
            >
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

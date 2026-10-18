"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui";

const ITEMS = [
  { href: "/resident", label: "Home", match: (p: string) => p === "/resident" },
  { href: "/report", label: "Report a problem", match: (p: string) => p.startsWith("/report") && !p.startsWith("/reports") },
  { href: "/reports", label: "Search reports", match: (p: string) => p.startsWith("/reports") },
  { href: "/my-reports", label: "My reports", match: (p: string) => p.startsWith("/my-reports") },
];

export function ResidentNav() {
  return <NavLinks pathname={usePathname()} />;
}

/** Static version for the prerendered shell (no active state until the URL is known). */
export function ResidentNavFallback() {
  return <NavLinks pathname="" />;
}

function NavLinks({ pathname }: { pathname: string }) {
  return (
    <nav aria-label="Service" className="-mb-px flex gap-1 overflow-x-auto [scrollbar-width:none]">
      {ITEMS.map((item) => {
        const active = item.match(pathname);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cx(
              "whitespace-nowrap border-b-4 px-3 py-3 text-sm font-semibold transition-colors",
              active ? "border-scc-magenta text-scc-navy" : "border-transparent text-slate-600 hover:border-slate-300 hover:text-scc-navy",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

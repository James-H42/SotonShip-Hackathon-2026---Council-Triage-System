import { faMagnifyingGlass, faUserShield } from "@fortawesome/free-solid-svg-icons";
import Image from "next/image";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { Icon } from "@/components/icons";
import { requireOfficer } from "@/lib/auth";
import { getDashboardStats } from "@/lib/data";
import { officerLogout } from "../(auth)/login/actions";
import { ConsoleNav } from "./ConsoleNav";

async function NavWithCounts() {
  await requireOfficer();
  const s = getDashboardStats();
  return <ConsoleNav counts={{ open: s.open, needsReview: s.needsReview, duplicates: s.duplicates, dubious: s.dubious }} />;
}

async function OfficerBadge() {
  const officer = await requireOfficer();
  const initials = officer.name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <div className="flex items-center gap-3 border-t border-white/10 p-4 text-sm">
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-scc-magenta text-xs font-bold text-white">{initials}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-white" data-testid="officer-name">
          {officer.name}
        </p>
        <form action={officerLogout}>
          <button className="text-xs font-medium text-white/60 hover:text-white">Sign out</button>
        </form>
      </div>
    </div>
  );
}

export default function ConsoleLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-[#eef0f3] lg:flex-row">
      <aside className="no-print flex shrink-0 flex-col bg-scc-navy text-white lg:sticky lg:top-0 lg:h-screen lg:w-64">
        <Link href="/council" className="block border-b border-white/10 px-5 py-5">
          <Image src="/brand/logo-whiteout-redesign.png" alt="Southampton City Council" width={177} height={40} unoptimized className="h-9 w-auto" />
          <span className="mt-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-scc-focus">
            <Icon icon={faUserShield} /> Street Triage Console
          </span>
        </Link>
        <Suspense fallback={<div className="flex-1" />}>
          <NavWithCounts />
        </Suspense>
        <Suspense fallback={<div className="h-16" />}>
          <OfficerBadge />
        </Suspense>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
          <div className="flex items-center gap-3 px-4 py-2.5 lg:px-8">
            <form action="/council" className="relative max-w-lg flex-1" role="search">
              <Icon icon={faMagnifyingGlass} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <label htmlFor="console-search" className="sr-only">
                Search reports
              </label>
              <input
                id="console-search"
                name="q"
                placeholder="Search reports by reference, street or words"
                className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm focus:border-scc-blue focus:bg-white focus:outline-none focus:ring-2 focus:ring-scc-blue/25"
              />
            </form>
            <span className="ml-auto hidden rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-900 sm:inline">Prototype data</span>
          </div>
        </header>
        <div className="min-w-0 flex-1 px-4 py-6 lg:px-8">{children}</div>
      </div>
    </div>
  );
}

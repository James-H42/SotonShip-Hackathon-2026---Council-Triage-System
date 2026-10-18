import { faCircleUser, faRightToBracket } from "@fortawesome/free-solid-svg-icons";
import Image from "next/image";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { Icon } from "@/components/icons";
import { SccFooter } from "@/components/SccFooter";
import { getResident } from "@/lib/auth";
import { getResidentAccount } from "@/lib/repo/residents";
import { residentSignOut } from "./actions";
import { ResidentNav, ResidentNavFallback } from "./ResidentNav";

async function AccountLinks() {
  const session = await getResident();
  if (!session) {
    return (
      <Link href="/resident/login" className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold text-white hover:bg-white/10">
        <Icon icon={faRightToBracket} /> Sign in
      </Link>
    );
  }
  const account = getResidentAccount(session.residentId);
  return (
    <div className="flex items-center gap-1">
      <Link href="/my-reports" className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold text-white hover:bg-white/10" data-testid="resident-account">
        <Icon icon={faCircleUser} className="text-lg" />
        <span className="hidden sm:inline">{account?.firstName || session.email}</span>
      </Link>
      <form action={residentSignOut}>
        <button className="rounded-md px-3 py-2 text-sm text-white/80 hover:bg-white/10 hover:text-white" data-testid="resident-signout">
          Sign out
        </button>
      </form>
    </div>
  );
}

export default function ResidentLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-scc-focus focus:px-3 focus:py-2 focus:text-black">
        Skip to main content
      </a>
      <div className="bg-scc-sand text-xs text-slate-700">
        <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-1.5">
          <span className="rounded-sm bg-scc-magenta px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">Prototype</span>
          <span>This is a SotonShip 2026 prototype for Southampton City Council, not a live council service.</span>
        </div>
      </div>
      <header className="bg-scc-navy">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4">
          <Link href="/resident" className="flex items-center gap-4" aria-label="Report a street problem, resident home">
            <Image src="/brand/logo-whiteout-redesign.png" alt="Southampton City Council" width={177} height={40} priority unoptimized className="h-9 w-auto sm:h-10" />
            <span className="hidden border-l border-white/30 pl-4 font-display text-lg font-semibold text-white md:block">Report a street problem</span>
          </Link>
          <Suspense fallback={<span className="h-9 w-20" />}>
            <AccountLinks />
          </Suspense>
        </div>
      </header>
      <div className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-4">
          <Suspense fallback={<ResidentNavFallback />}>
            <ResidentNav />
          </Suspense>
        </div>
      </div>
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        {children}
      </main>
      {/* Contact details only (see components/SccFooter.tsx). */}
      <SccFooter />
    </>
  );
}

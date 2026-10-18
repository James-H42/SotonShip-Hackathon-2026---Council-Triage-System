import { faLock, faShieldHalved } from "@fortawesome/free-solid-svg-icons";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { Icon } from "@/components/icons";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Staff sign in" };

export default function LoginPage() {
  return (
    <main className="grid flex-1 bg-console-950 lg:grid-cols-2">
      <section className="hidden flex-col justify-between bg-gradient-to-br from-scc-navy to-scc-navy-2 p-12 text-white lg:flex">
        <Image src="/brand/logo-whiteout-redesign.png" alt="Southampton City Council" width={221} height={50} unoptimized className="h-12 w-auto self-start" />
        <div>
          <p className="text-sm font-semibold uppercase tracking-widest text-white/70">Street Triage Console</p>
          <h1 className="mt-3 font-display text-4xl font-bold leading-tight">Every street report, ranked and ready to act on.</h1>
          <ul className="mt-6 space-y-2 text-white/80">
            <li>Prioritised queue with council policy built in</li>
            <li>Duplicate merging and human review of uncertain reports</li>
            <li>Daily routes for two-person repair crews</li>
          </ul>
        </div>
        <p className="text-xs text-white/50">Prototype for SotonShip 2026</p>
      </section>
      <section className="flex items-center justify-center px-4 py-16">
        <div className="w-full max-w-sm">
          <Image src="/brand/scc-badge-white.svg" alt="Southampton City Council" width={64} height={64} unoptimized className="mb-6 h-16 w-16 lg:hidden" />
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-scc-focus">
            <Icon icon={faShieldHalved} /> Council staff only
          </p>
          <h2 className="mt-2 font-display text-2xl font-bold text-white">Sign in to the triage console</h2>
          <p className="mt-1 mb-8 text-sm text-slate-400">Use your council account. Residents should use the public site to report or track a problem.</p>
          <div className="rounded-2xl border border-white/10 bg-console-900 p-6">
            <Suspense>
              <LoginForm />
            </Suspense>
          </div>
          <p className="mt-4 flex items-center gap-2 text-xs text-slate-500">
            <Icon icon={faLock} /> Access is logged. Unauthorised use is not permitted.
          </p>
          <p className="mt-6 text-center text-sm text-slate-400">
            <Link href="/" className="hover:text-white">
              Not council staff? Go back to the start
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}

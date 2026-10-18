import { faArrowRight, faHouseUser, faUserShield } from "@fortawesome/free-solid-svg-icons";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Icon } from "@/components/icons";
import { SccFooter } from "@/components/SccFooter";

export const metadata: Metadata = { title: { absolute: "Street problems | Southampton City Council" } };

/** The service starts here: residents and council staff take separate journeys. */
export default function Chooser() {
  return (
    <>
      <div className="bg-scc-sand text-xs text-slate-700">
        <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-1.5">
          <span className="rounded-sm bg-scc-magenta px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">Prototype</span>
          <span>This is a SotonShip 2026 prototype for Southampton City Council, not a live council service.</span>
        </div>
      </div>
      <header className="bg-scc-navy">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-4">
          <Image src="/brand/logo-whiteout-redesign.png" alt="Southampton City Council" width={177} height={40} priority unoptimized className="h-9 w-auto sm:h-10" />
          <span className="hidden border-l border-white/30 pl-4 font-display text-lg font-semibold text-white md:block">Street problems</span>
        </div>
      </header>
      <main id="main" className="flex-1 bg-gradient-to-b from-scc-navy to-scc-navy-2 px-4 pb-16 pt-10 text-white sm:pt-16">
        <div className="mx-auto max-w-5xl">
          <h1 className="font-display text-3xl font-bold leading-tight sm:text-5xl">How would you like to continue?</h1>
          <p className="mt-3 max-w-2xl text-lg text-white/85">Choose the option that describes you. You can come back here at any time.</p>
          <ul className="mt-10 grid gap-6 md:grid-cols-2">
            <li>
              <Link
                href="/resident"
                data-testid="choose-resident"
                className="group flex h-full flex-col rounded-2xl bg-white p-8 text-scc-navy shadow-xl ring-1 ring-white/20 transition hover:-translate-y-1 focus-visible:outline-4 focus-visible:outline-scc-focus"
              >
                <span className="flex h-16 w-16 items-center justify-center rounded-xl bg-scc-magenta text-3xl text-white">
                  <Icon icon={faHouseUser} />
                </span>
                <span className="mt-6 font-display text-2xl font-bold sm:text-3xl">I&apos;m a resident</span>
                <span className="mt-2 text-base text-slate-600">
                  Report a pothole, fly-tipping, a broken street light or another street problem, and follow it until it is fixed.
                </span>
                <span className="mt-auto inline-flex items-center gap-2 pt-8 text-lg font-semibold text-scc-magenta group-hover:underline">
                  Continue as a resident <Icon icon={faArrowRight} />
                </span>
              </Link>
            </li>
            <li>
              <Link
                href="/council"
                data-testid="choose-council"
                className="group flex h-full flex-col rounded-2xl bg-console-950 p-8 text-white shadow-xl ring-1 ring-white/15 transition hover:-translate-y-1 focus-visible:outline-4 focus-visible:outline-scc-focus"
              >
                <span className="flex h-16 w-16 items-center justify-center rounded-xl bg-white/10 text-3xl text-scc-focus">
                  <Icon icon={faUserShield} />
                </span>
                <span className="mt-6 font-display text-2xl font-bold sm:text-3xl">I work for the council</span>
                <span className="mt-2 text-base text-slate-300">Sign in to the Street Triage Console to review, prioritise and plan repairs for reported problems.</span>
                <span className="mt-auto inline-flex items-center gap-2 pt-8 text-lg font-semibold text-scc-focus group-hover:underline">
                  Council staff sign in <Icon icon={faArrowRight} />
                </span>
              </Link>
            </li>
          </ul>
        </div>
      </main>
      <SccFooter flush />
    </>
  );
}
